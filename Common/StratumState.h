/*
 * This code is released under the MIT license.
 * For conditions of distribution and use, see the LICENSE or hit the web.
 */
#pragma once
#include <memory>
#include <queue>
#include <time.h>
#include <json/reader.h>
#include "../Common/Stratum/messages.h"
#include "../Common/Stratum/parsing.h" // DecodeHEX
#include "../Common/ScopedFuncCall.h"
#include "../Common/SerializationBuffers.h"
#include "../Common/BTC/Funcs.h"
#include "../Common/Stratum/WorkUnit.h"
#include <sstream>
#include <iomanip>
#include "Settings.h"

using std::string;

/*! Stratum is a stateful protocol and this structure encapsulates it.
Legacy miners put everything in a single structure regarding pools.
So do I, but I do it with some care. */
class StratumState {
	size_t nextRequestID;
	time_t dataTimestamp;
	stratum::MiningSubscribeResponse subscription; //!< comes handy!
	stratum::MiningNotify block; //!< sent by remote server and stored here
	double difficulty;
	std::array<aubyte, 128> blankHeader;
	asizei merkleOffset;
    std::string nameVer;
	
	struct Worker {
		std::string name; //!< server side login credentials
		const auint id; //!< message ID used to request authorization. Not const because I build those after putting the message in queue.
		time_t authorized; //!< time when the authorization result was received, implies validity of canWork flag.
		bool canWork; //!< only meaningful after authorization, false if authorization failed.
		Worker(const char *login, const asizei msgIndex) : id(msgIndex), authorized(0), canWork(false), name(login) { }
	};
	std::vector<Worker> workers;

	//! Messages generated by the client must have their ids generated.
	//!\returns the used ID.
	size_t PushMethod(const char *method, const string &pairs);

	//! When replying to the server instead we have to use its id, which can be arbitrary.
	void PushResponse(const std::string &id, const string &pairs);

	/*! The requests I send to the server have an ID I decide.  The server will reply with that ID and
	I'll have to remember what request I made to it. This maps IDs to request strings so I can support
	help the outer code in mangling responses. */
	std::map<size_t, const char*> pendingRequests;


protected:
	template<typename ValueType>
	string KeyValue(const char *key, const ValueType &value, bool quoteValue = true) {
		std::stringstream str;
		str<<'"'<<key<<'"'<<": ";
		if(quoteValue)  str<<'"'<<value<<'"';
		else str<<value;
		return str.str();
	}
	template<typename ValueType>
	string Quoted(const ValueType &str) {
		string uff("\"");
		return uff + str + "\"";
	}

public:
	struct Shares {
		aulong sent;
		aulong accepted;
		Shares() : sent(0), accepted(0) { }
	} shares;
	aulong errorCount;

	const aulong coinDiffMul;
	const PoolInfo::MerkleMode merkleMode;
	StratumState(const char *presentation, aulong diffOneMul, PoolInfo::MerkleMode hashMode);
	const string& GetSessionID() const { return subscription.sessionID; }
	/*! The outer code should maintain a copy of this value. This to understand when the
	work unit sent by the remote host has changed. It then makes sense to call RestartWork(). */
	time_t Working() const { return dataTimestamp; }

	/*! If the remote work unit has changed, it might make sense to drop the current work as
	instructed. Note this is a const call and thus there's no way to tell this you have restarted.
	It does not need to know, nor you do as you're going to poll this only on work changes. */
	bool RestartWork() const { return block.clear; }

	stratum::WorkUnit* GenWorkUnit(auint nonce2) const;

	/*! Registering a worker (server side concept) is something which must be performed by outer code.
	It is best to do that after mining.notify but before generating a work unit.
	This effectively queues "mining.authorize" messages to server. Keep in mind it will take some time
	before workers are authorized. Workers are never registered more than once (function becomes NOP).
	\param user name to use to authorize worker (server-side concept).
	\param psw the password can be empty string. */
	void Authorize(const char *user, const char *psw);

	/*! Returns true if the given worker has attempted authorization. It might be still being authorized
	or perhaps it might have failed registration. \sa CanSendWork */
	bool IsWorker(const char *name) const;

	/*! If the job is still considered active then this returns the job ntime to be used for share submission.
	Otherwise, it returns 0. That is considered by the stratum manager too old and thus likely to be rejected.
	The outer code shall drop those shares as they have no valid ntime to be produced. */
	auint GetJobNetworkTime(const std::string &job) const { return block.job == job? block.ntime : 0; }

	/*! First element returned is true if we received authorization response. It then makes sense to
	consider the next flag, which is the result of the authentication. A worker can send work if both
	flags are true. */
	std::pair<bool, bool> CanSendWork(const char *name) const;

	void SendWork(auint ntime, auint nonce2, auint nonce);
	
	/*! This structure contains an indivisible amount of information to	send the server via socket.
	The message might be long, and multiple calls to send(...) might be needed. Rather than blocking
	this thread I keep state about the messages and I send them in order.
	Scheduling is easier and performed at higher level. */
	struct Blob {
		__int8 *data;
		const size_t total;
		const size_t id;
		size_t sent;
		Blob(const __int8 *msg, size_t count, size_t msgID)
			: total(count), sent(0), data(nullptr), id(msgID) {
			data = new __int8[total];
			memcpy_s(data, total, msg, total);
		}
		// note no destructor --> leak. I destruct those when the pool is destroyed so copy
		// is easy and no need for unique_ptr
	};
	std::queue<Blob> pending;

	~StratumState() {
		while(pending.size()) {
			Blob &blob(pending.front());
			delete[] pending.front().data;
			pending.pop();
		}
	}

	// .id and .method --> Request \sa RequestReplyReceived
	void Request(const stratum::ClientGetVersionRequest &msg);

	// .id and .result --> Response (to some of our previous inquiry)
	/*! Call this function to understand what kind of request resulted in the
	received response. Use this to select a proper parsing methodology. */
	const char* Response(size_t id) const;

	void Response(size_t id, const stratum::MiningSubscribeResponse &msg) { subscription = msg; }
	void Response(asizei id, const stratum::MiningAuthorizeResponse &msg);
	void Response(asizei id, const stratum::MiningSubmitResponse &msg);
	
	void Notify(const stratum::MiningSetDifficultyNotify &msg) { difficulty = msg.newDiff; }
	void Notify(const stratum::MiningNotify &msg);

	/*! When a reply to a requesti is received, no matter if successful or not, you use Response to identify the original type of request and then issue
	a Response call accordingly. After processing has elapsed, call this function the free the resources allocated to remember the message which was just processed.
	Note to this purpose the success flag is not dependant on the message itself but whathever it was a response rather than an error.
	\param[in] id To identify the message to be removed.
	\param[in] success Set this to false if the reply was an error.
	\note Signaling an error at this point just increments the errorCount counter in addition to usual cleanup. */
	void RequestReplyReceived(asizei id, bool success) {
		pendingRequests.erase(pendingRequests.find(id)); // guaranteed to exist as code will have used Response(asizei) before this and also the appropriate response calls!
		if(!success) errorCount++;
	}
};

/*! \todo It appears obvious this object is not in the correct place
it should be in the stratum namespace I guess
and likely also have a different name
Still here until I figure out the details and separation of concerns. */
