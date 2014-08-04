/*
 * This code is released under the MIT license.
 * For conditions of distribution and use, see the LICENSE or hit the web.
 */
#pragma once
#include <string>
#include <vector>
#include <memory>

using std::string;
using std::unique_ptr;

struct PoolInfo {
	string appLevelProtocol; // the initial "stratum+"
	string service; // usually "http". Follows "://", but I'm not including those. If not found, set "http"
	string host; // stuff up to :, if found
	string explicitPort; // I keep it as string, it's used as string in sockets anyway
	unsigned __int64 diffOneMul; //!< BTC: 1, LTC: 64*1024, QRK: 256. Using the LTC constant is really the best thing to do by default as this implies no work (detected as valid) will get trashed (big IF)
	const string user;
	const string pass;
	PoolInfo(const string &url, const string &userutf8, const string &passutf8)
		: user(userutf8), pass(passutf8), diffOneMul(64 * 1024), merkleMode(mm_SHA256D) {
		if(url.find("stratum+") == 0) appLevelProtocol = "stratum";
		else throw std::exception("Pool is required to be stratum for the time being.");
		string rem = url.substr(strlen("stratum+"));
		size_t stop = rem.find("://");
		if(stop < rem.length()) {
				service = rem.substr(0, stop);
				rem = rem.substr(stop + 3);
		}
		else service = "http";
		stop = rem.find(':');
		host = rem.substr(0, stop);
		if(stop == rem.length()) { } // use the service default
		else explicitPort = rem.substr(stop + 1);
	}
	enum MerkleMode {
		mm_SHA256D,
		mm_singleSHA256
	};
	MerkleMode merkleMode;
};


struct Settings {
	std::vector< unique_ptr<PoolInfo> > pools;
	std::string driver, algo, impl;
	enum ImplParamType {
		ipt_uint
	};
	struct ImplParam {
		ImplParamType type;
		std::string name;
		union {
			unsigned int valueUINT;
		};
		ImplParam(const char *pname, const unsigned int &v) : name(pname), type(ipt_uint) { valueUINT = v; }
	};
	std::vector<ImplParam> implParams;
	bool checkNonces; //!< if this is false, the miner thread will not re-hash nonces and blindly consider them valid

	Settings() : checkNonces(true) { }
};

/*! This structure contains every possible setting, in a way or the other.
On creation, it sets itself to default values - this does not means it'll
produce workable state, some settings such as the pool to mine on cannot 
be reasonably guessed. */