/*
 * This code is released under the MIT license.
 * For conditions of distribution and use, see the LICENSE or hit the web.
 */
#pragma once
#include "../AbstractWorkSource.h"
#include "../../Common/PoolInfo.h"
#include "../../Common/AREN/ScopedFuncCall.h"
#include "../../Common/Stratum/parsing.h"
#include "../../Common/BTC/Funcs.h"
#include "../Network.h"
#include <functional>

using std::string;

/*! The simplest way to deal with pools. Just connect to the specified one using the socket passed as ctor. */
class FirstPoolWorkSource : public AbstractWorkSource {
public:
	const PoolInfo &fetching;
	FirstPoolWorkSource(const char *clientPresentation, const AlgoInfo &algoParams, const PoolInfo &init, NetworkInterface::ConnectedSocketInterface &pipe);
	~FirstPoolWorkSource();

	typedef std::function<void(asizei index, int errorCode, const std::string &message)> ErrorFunc;
	
	//! This function gets called by MangleError.
	ErrorFunc errorCallback;
	
	static ErrorFunc DefaultErrorCallback(bool silent) {
		if(silent) return [](asizei i, int errcode, const std::string& message) { };
		return [](asizei i, int errcode, const std::string& message) { 
			std::string err("Stratum message [");
			err += std::to_string(i) + "] generated error response by server (code " + std::to_string(errcode) + ").";
			throw err;
		};
	}

private:
	NetworkInterface::ConnectedSocketInterface &pipe;
	
	template<typename Parser>
	void MangleResult(bool &processed, const char *originally, size_t id, const rapidjson::Value &object, Parser &parser) {
		if(processed) return;
		if(parser.name != originally) return;
		std::unique_ptr<Parser::Product> dispatch(parser.Mangle(object));
		//if(dispatch.get() == nullptr) return; // impossible, would have thrown
		stratum.Response(id, *dispatch.get());
		processed = true;
	}
	
	template<typename Parser>
	void MangleRequest(bool &processed, const char *methodName, const string &id, const rapidjson::Value &paramsArray, Parser &parser) {
		if(processed) return;
		if(parser.name != methodName) return;
		std::unique_ptr<Parser::Product> dispatch(parser.Mangle(id, paramsArray));
		//if(dispatch.get() == nullptr) return; // impossible, would have thrown
		stratum.Request(*dispatch.get());
		processed = true;
	}
	
	template<typename Parser>
	void MangleNotification(bool &processed, const char *methodName, const rapidjson::Value &paramsArray, Parser &parser) {
		if(processed) return;
		if(parser.name != methodName) return;
		std::unique_ptr<Parser::Product> dispatch(parser.Mangle(paramsArray));
		//if(dispatch.get() == nullptr) return; // impossible, would have thrown
		stratum.Notify(*dispatch.get());
		processed = true;
	}

protected:
	void MangleReplyFromServer(size_t id, const rapidjson::Value &result, const rapidjson::Value &error);
	void MangleMessageFromServer(const std::string &idstr, const char *signature, const rapidjson::Value &notification);
	asizei Send(const abyte *data, const asizei count);
	asizei Receive(abyte *storage, asizei rem);

	static std::vector< std::pair<const char*, const char*> > PullCredentials(const PoolInfo &pool) { 
		std::vector< std::pair<const char*, const char*> > ret;
		ret.push_back(std::make_pair(pool.user.c_str(), pool.pass.c_str()));
		return ret;
	}
};
