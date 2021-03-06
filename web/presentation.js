"use strict"
/*
 * This code is released under the MIT license.
 * For conditions of distribution and use, see the LICENSE or hit the web.
 */
/* This file contains various helper functions closely bound to HTML source.
They manipulate the DOM tree and respond to various messages from server. 
...
Mostly presentation. It comes handy to evolve state as well. */

var presentation = {
	hashTimeCells: [], // one entry for each device, no matter if enabled or not, by linear index
	noncesCells: [],
	perfMode: "itime", // if "iteration time" show performance in milliseconds, else ("hashrate") show in khs/mhs/whatever
	resultTimeElapsedRefresh: null,
	
	showReplyTime: function(pings) {
		document.getElementById("ping").textContent = Math.ceil(pings * 1000);
	},

	appendDevicePlatforms: function(pdesc) {
		document.getElementById("M8M_API").textContent = pdesc.API;
		var sysInfoCont = document.getElementById("sysInfoDevices");
		var linearIndex = 0;
		for(var i = 0; i < pdesc.platforms.length; i++) {
			var row = document.createElement("tr");
			var cell = document.createElement("td");
			var platform = pdesc.platforms[i];
			cell.rowSpan = Math.max(platform.devices.length, 1);
			cell.innerHTML = "<em>" + platform.name + "</em><br>by " +
							 platform.vendor + "<br>" +
							 platform.version + "<br>" + platform.profile.replace("_", " ").toLowerCase();
			row.appendChild(cell);
			for(var d = 0; d < pdesc.platforms[i].devices.length; d++) {
				if(d) row = document.createElement("tr");
				pdesc.platforms[i].devices[d].linearIndex = linearIndex++;
				pdesc.platforms[i].devices[d]
				describeDevice(row, pdesc.platforms[i].devices[d]);
				sysInfoCont.appendChild(row);
				server.hw.linearDevice.push(pdesc.platforms[i].devices[d]);
			}
			if(pdesc.platforms[i].devices.length == 0) {
				var whoops = document.createElement("td");
				whoops.colSpan = 5;
				whoops.textContent = "No devices found in this platform (?).";
				row.appendChild(whoops);
				sysInfoCont.appendChild(row);
			}
		}
		var numDevice = 0;
		for(var p = 0; p < pdesc.platforms.length; p++) {
			for(var d = 0; d < pdesc.platforms[p].devices.length; d++) {
				pdesc.platforms[p].devices[d].linearIndex = numDevice;
				numDevice++;
			}
		}
		pdesc.linearDevice = [];
		for(var p = 0; p < pdesc.platforms.length; p++) {
			for(var d = 0; d < pdesc.platforms[p].devices.length; d++) {
				pdesc.linearDevice.push(pdesc.platforms[p].devices[d]);
			}
		}
		window.server.hw = pdesc;
		
		/*!
		\param yourLine A <tr> element to push <td>
		\param device CLDeviceDesc object. */
		function describeDevice(yourLine, device) {
			var typology = device.type + (device.arch? ', ' + '<strong>' + device.arch + '</strong>' : '');
			var chipDetail = '<em>' + device.chip.replace("(tm)", "\u2122") + '</em>'; // + ' (0x' + device.vendorID.toString(16) + ')';
			var chipPower = device.clusters + ' cores @ ' + device.coreClock + ' Mhz';
			addCell(typology + '<br>' + chipDetail + '<br>' + chipPower);
			
			var global = "RAM: " + Math.floor(device.globalMemBytes / 1024 / 1024) + " MiB";
			var cache = "Cache: " + Math.floor(device.globalMemCacheBytes / 1024) + " KiB";
			var lds = "";
			if(device.lds == 0 || (device.ldsType && device.ldsType == "none")) {}
			else {
				lds += "Local: " + Math.floor(device.ldsBytes / 1024) + " KiB";
				if(device.ldsType == "global") lds += "(emu)";
			}
			addCell(global + '<br>' + cache + '<br>' + lds);
			device.configCell = addCell("...");
			addCell(device.linearIndex);
			
			function addCell(text) {
				var c = document.createElement("td");
				c.innerHTML = text;
				yourLine.appendChild(c);
				return c;
			}
		}
	},


	updateMiningElements: function(reply) {
		var algo = document.getElementById("algo");
		var algoTitle = document.getElementById("algoTitle");
		var impl = document.getElementById("implementation");
		var version = document.getElementById("implVersion");
		
		if(!algoTitle) { // first time, generate
			var div = document.createElement("div");
			compatible.modClass(div, "detailsBox", "add");
			div.style.display = "none";
			div.style.zIndex = 10;
			var string = "<h3>Algorithm details</h3>";
			string += "<strong>Name:</strong> <span id='algoTitle'></span><br>";
			string += "<strong>Implementation:</strong> <span id='implementation'></span><br>";
			string += "<strong>Version signature:</strong> <span id='implVersion'></span><br>";
			div.innerHTML = string;
			document.getElementById("miningStatus").appendChild(div);
			var shbutton = presentation.support.makeDetailShowHideButton(div, "Close");
			compatible.setEventCallback(document.getElementById("algoDetails"), "click", function(click) {
				presentation.support.showHideBTNFunc(this, div, click);
			});
			div.appendChild(shbutton);
			presentation.support.makeMovable(div);
			algoTitle = document.getElementById("algoTitle");
			impl = document.getElementById("implementation");
			version = document.getElementById("implVersion");
		}
		
		if(!reply.algo) {
			compatible.modClass([algo, algoTitle, impl, version], "hugeError", "add");
			algo.innerHTML = "<strong>!! nothing !!</strong>";
			algoTitle.innerHTML = "!! nothing !!";
			impl.textContent = "!! N/A !!";
			version.textContent = "!! N/A !!";
			compatible.modClass([algo, algoTitle, impl, version], "hugeError", "add");
		}
		else if(!reply.impl || !reply.version) { // in general, either both or none will be defined
			compatible.modClass([algo, algoTitle], "hugeError", "remove");
			compatible.modClass([impl, version], "hugeError", "add");
			algo.innerHTML = algoTitle.innerHTML = reply.algo;
			impl.textContent = "!! ??? !!";
			version.textContent = "!! ??? !!"; // will likely never happen	
		}
		else {
			compatible.modClass([algo, algoTitle, impl, version], "hugeError", "remove");
			algo.innerHTML = algoTitle.innerHTML = reply.algo;
			impl.textContent = reply.impl;
			version.textContent = reply.version;
		}
	},


	updatePoolElements: function(object) {
		var poolName = document.getElementById("poolName");
		var authStatus = document.getElementById("authStatus");
		var authWarning = document.getElementById("poolAuthWarning");
		
		document.getElementById("pool").textContent = poolName.textContent = object.name;
		document.getElementById("poolURL").textContent = object.url;
		if(object.users.length !== 1) {
			var errormsg = "Multiple workers, not yet supported by client.";
			alert(errormsg);
			throw errormsg;
		}
		var refresh = false;
		document.getElementById("user").textContent = object.users[0].login;
		switch(object.users[0].authorized) {
		case false: 
			authStatus.innerHTML = "<strong>failed</strong>";
			authWarning.innerHTML = "<strong>failed authorization<strong>";
			break;
		case true:
			authStatus.textContent = "authorized";
			authWarning.textContent = "";
			break;
		case "pending":
			authStatus.textContent = "pending";
			authWarning.textContent = "(waiting for authorization)";
			refresh = true;
			break;
		case "inferred":
			authStatus.innerHTML = "<em>shares accepted</em>";
			authWarning.textContent = "";
			break;
		case "open":
			authStatus.innerHTML = "<em>not required</em>";
			authWarning.textContent = "";
		}
		return refresh;
	},
	
	updateConfigElements: function(devConfs) {
		var tbody = document.getElementById("sysInfoDevices");
		var used = 0;
		for(var loop = 0; loop < devConfs.length; loop++) {
			var dev = server.hw.linearDevice[loop];
			if(devConfs[loop] === "off") dev.configCell.innerHTML = "Not used";
			else {
				dev.configCell.textContent = "Using [" + devConfs[loop] + ']';
				used++;
			}
		}
		var usePatterns = false;
		var thumbs = presentation.patterns(20, used, usePatterns? { glyphs: presentation.glyphs } : undefined);
		compatible.modClass(thumbs, "devicePattern", "add");
		var take = 0;
		for(var loop = 0; loop < server.hw.platforms.length; loop++) {
			for(var inner = 0; inner < server.hw.platforms[loop].devices.length; inner++) {
				var device = server.hw.platforms[loop].devices[inner];
				if(devConfs[device.linearIndex] === "off") continue;
				device.visPattern = thumbs[take];
				device.configIndex = devConfs[device.linearIndex];
				
				var separator = document.createTextNode(",");
				
				device.configCell.appendChild(separator);
				device.configCell.appendChild(document.createElement("br"));
				device.configCell.appendChild(thumbs[take]);
				take++;				
			}
		}
	},
	
	updateRejectElements: function(rejInfo) {
		function buildReasonsLine(container, cfgRej) {
			var line = document.createElement("tr");
			var cell = document.createElement("td");
			cell.textContent = '[' + cfgRej.confIndex + ']';
			cell.rowSpan = cfgRej.reasons.length;
			line.appendChild(cell);
			for(var loop = 0; loop < cfgRej.reasons.length; loop++) {
				cell = document.createElement("td");
				cell.innerHTML = cfgRej.reasons[loop];
				line.appendChild(cell);
				container.appendChild(line);
				line = document.createElement("tr");
			}
		}
		for(var loop = 0; loop <  rejInfo.length; loop++) {
			var device = server.hw.linearDevice[loop];
			device.configCell.appendChild(document.createElement("br"));
			/* Since protocol version 1.1 a device can be in use and still have configuration reject reasons.
			This is perfectly normal and supposed to be the cornerstone to have multiple configurations depending on device performance.
			The catch here is rejInfo[i].reasons is guaranteed (by protocol spec) to be non-empty. */
			var div = document.createElement("div");
			compatible.modClass(div, "detailsBox", "add");
			div.style.display = "none";
			div.style.zIndex = loop * 10 + 50;
			div.innerHTML = "<h3>Configuration reject reasons</h3><strong>For device " + loop + "</strong><br>";
			if(rejInfo[loop].length === 0) {
				div.innerHTML += "This device is eligible to all configurations.<br>";
			}
			else {
				var table = document.createElement("table");
				var section = document.createElement("thead");
				var row = document.createElement("tr");
				var text = [ "Configuration", "Reasons" ];
				for(var c = 0; c < 2; c++) {
					var cell = document.createElement("th");
					cell.innerHTML = text[c];
					row.appendChild(cell);
				}
				section.appendChild(row);
				table.appendChild(section);
				section = document.createElement("tbody");
				for(var conf = 0; conf < rejInfo[loop].length; conf++) {
					var rr = rejInfo[loop][conf];
					for(var rc = 0; rc < rr.reasons.length; rc++) buildReasonsLine(section, rr);
				}
				table.appendChild(section);
				div.appendChild(table);
			}
			div.appendChild(presentation.support.makeDetailShowHideButton(div, "Close"));
			var container = document.getElementById("sysInfo");
			container.appendChild(div);
			var btn = presentation.support.makeDetailShowHideButton(div, "Details");
			device.configCell.appendChild(btn);
			presentation.support.makeMovable(div);
		}
	},
	
	updateConfigInfo: function(cinfo) {
		var tbody = document.getElementById("configInfo");
		if(cinfo === null || cinfo.length === 0) {   // happens when not mining due to load file error
			var row = document.createElement("tr");
			var td = document.createElement("td");
			td.innerHTML = "!! no algorithm running !!";
			td.colSpan = 14; // I should really find a way to make this shit automatic...
			compatible.modClass(td, "hugeError", "add");
			row.appendChild(td);
			tbody.appendChild(row);
		    return;
		}
		while(tbody.childNodes.lastChild) tbody.childNodes.removeChild(tbody.childNodes.lastChild);
		for(var conf = 0; conf < cinfo.length; conf++) {
			server.config[conf] = {};
			server.config[conf].hashCount = [];
			
			var row = document.createElement("tr");
			staticCell(row, "[" + conf + "]", cinfo[conf].length);
			
			if(cinfo[conf].length == 0) {
				var whoops = document.createElement("td");
				whoops.colSpan = 10;
				whoops.textContent = "Configuration is unused.";
				row.appendChild(whoops);
				tbody.appendChild(row);
			}
			else {
				var sameHC = true; // it is assumed same hashCount <-> same resources
				for(var devSlot = 0; devSlot < cinfo[conf].length - 1; devSlot++) {
					sameHC &= cinfo[conf][devSlot].hashCount == cinfo[conf][devSlot + 1].hashCount;
				}
				if(sameHC) {
					staticCell(row, "" + cinfo[conf][0].hashCount, cinfo[conf].length);
					var mem = staticCell(row, Math.ceil(totalMU(cinfo[conf][0].memUsage) / 1024.0) + " KiB<br>", cinfo[conf][0].length);
					var report = makeMemoryReport(conf, "For all devices using configuration [" + conf + ']', cinfo[conf][0].memUsage);
					for(var cp = 0; cp < cinfo[conf].length; cp++) server.config[conf].hashCount[cp] = cinfo[conf][cp].hashCount;
					mem.appendChild(presentation.support.makeDetailShowHideButton(report, "Details"));
					document.getElementById("miningStatus").appendChild(report);
				}
				for(var devSlot = 0; devSlot < cinfo[conf].length; devSlot++) {
					if(!row) row = document.createElement("tr");
					var devLinear = cinfo[conf][devSlot].device;
					if(!sameHC) {
						var cell = document.createElement("td");
						cell.textContent = cinfo[conf][devSlot].hashCount;
						row.appendChild(cell);
						var mem = makeCell("td", Math.ceil(totalMU(cinfo[conf][devSlot].memUsage) / 1024.0) + " KiB<br>");
						var report = makeMemoryReport(conf, "For device " + devLinear + ", using configuration [" + conf + ']', cinfo[conf][devSlot].memUsage);
						server.config[conf].hashCount = cinfo[conf][devSlot].hashCount;
						mem.appendChild(presentation.support.makeDetailShowHideButton(report, "Details"));
					}
					var cell = document.createElement("td");
					cell.textContent = "" + devLinear + ", ";
					var devColor = this.imgFromCanvas(window.server.hw.linearDevice[devLinear].visPattern);
					compatible.modClass(devColor, "devicePattern", "add");
					cell.appendChild(devColor);
					row.appendChild(cell);
					tbody.appendChild(row);
					row = null;
				}
			}
		}
		
		function makeCell(tag, html) {
			var ret = document.createElement(tag);
			ret.innerHTML = html;
			return ret;
		}
		function staticCell(container, html, numDevices) {
			var cell = makeCell("td", html);
			cell.rowSpan = Math.max(numDevices, 1);
			container.appendChild(cell);
			return cell;
		}
		// is reduce supported? that would be nice to try
		function totalMU(values) {
			if(values === undefined || values.length == 0) return 0;
			var total = 0;
			for(var loop = 0; loop < values.length; loop++) total += values[loop].footprint;
			return total;
		}
		function makeMemoryReport(index, subtitle, reslist) {
			var div = document.createElement("div");
			compatible.modClass(div, "detailsBox", "add");
			div.style.display = "none";
			div.style.zIndex = index * 10 + 50;
			div.innerHTML = "<h3>Memory usage estimation</h3><strong>" + subtitle + "</strong><br>Due to driver policies, this is a <em>lower bound</em>.";			
			var table = document.createElement("table");
			var section = document.createElement("thead");
			var row = document.createElement("tr");
			row.appendChild(makeCell("th", "Address space"));
			row.appendChild(makeCell("th", "Used as"));
			row.appendChild(makeCell("th", "Bytes used"));
			row.appendChild(makeCell("th", "Notes"));
			section.appendChild(row);
			table.appendChild(section);
			section = document.createElement("tbody");
			for(var loop = 0; loop < reslist.length; loop++) {
				row = document.createElement("tr");
				row.appendChild(makeCell("td", reslist[loop].space));
				row.appendChild(makeCell("td", reslist[loop].presentation));
				row.appendChild(makeCell("td", reslist[loop].footprint));
				row.appendChild(makeCell("td", concat(reslist[loop].notes)));
				section.appendChild(row);
			}
			table.appendChild(section);			
			div.appendChild(table);
			div.appendChild(presentation.support.makeDetailShowHideButton(div, "Close"));
			presentation.support.makeMovable(div);
			return div;
			
			function concat(arr) {
				var ret = "";
				for(var s = 0; s < arr.length; s++) {
					if(s) ret += ", ";
					ret += arr[s];
				}
				return ret;
			}
		}
	},
	
	refreshDevicePerf : function() {
		var niceHR;
		var names = ["min", "max", "last", "avg"];
		for(var loop = 0; loop < server.hw.linearDevice.length; loop++) { // if not hashrate mode, just ignore
			var check = server.hw.linearDevice[loop];
			if(check.configIndex === undefined) continue;
			
			var slowest = check.lastPerf[names[0]];
			if(slowest === undefined) slowest = 0;
			for(var scan = 1; scan < names.length; scan++) {
				var candidate = check.lastPerf[names[scan]];
				slowest = Math.max(slowest, candidate || 0);
			}
			var config = server.config[check.configIndex];
			var fit;
			if(slowest) fit = presentation.niceHashrate(1000 / slowest * config.hashCount);
			else continue; // this device does not contribute to choosing a divisor
			if(!niceHR || fit.divisor < niceHR.divisor) niceHR = fit;
		}
		
		var totalHR = 0;
		for(var d = 0; d < server.hw.linearDevice.length; d++) {
			var device = server.hw.linearDevice[d];
			var cells = this.hashTimeCells[device.linearIndex];
			if(!cells) continue; // not built so not used!
			var hashCount = server.config[device.configIndex].hashCount;
			for(var loop = 0; loop < names.length; loop++) {
				var t = device.lastPerf? device.lastPerf[names[loop]] : undefined;
				var dst = cells[names[loop]];
				if(t == 0 || t == undefined) { // undefined --> NaN?
					dst.textContent = "...";
					continue;
				}
				var ips = 1000 / t;
				if(names[loop] === "last") totalHR += hashCount * ips;
				if(this.perfMode === "itime") dst.textContent = t;
				else {
					if(loop < 2) dst = cells[names[(loop + 1) % 2]]; // min and max must be swapped
					dst.textContent = Math.floor(hashCount * ips / niceHR.divisor);
				}
			}
		}
		var big = presentation.niceHashrate(totalHR);
		document.getElementById("totalHashrate").textContent = "" + Math.floor(totalHR / big.divisor) + " " + big.prefix + "H/s";
		return niceHR? niceHR : presentation.niceHashrate(1);
	},
	
	// Policy to decide how to visualize an hashrate value. Returns an object prefix and divisor.
	niceHashrate: function(accurate) {
		var ret = {};
		var prefix = [ "", "K", "M", "G", "T", "P", "E", "Z", "Y" ];
		var divisor = 1;
		var diff, loop = 0;
		do {
			var value = Math.floor(accurate / divisor);
			diff = Math.abs(accurate - value);
			divisor *= 1000;
			loop++;
			
		} while(diff < accurate * .01);
		divisor /= 1000;
		loop--;
		ret.divisor = divisor;
		ret.prefix = prefix[loop];
		return ret;
	},
	
	refreshDeviceShareStats: function(obj) {
		for(var loop = 0; loop < server.hw.linearDevice.length; loop++) {
			var target = presentation.noncesCells[loop];
			if(target === null) continue;
			var names = [ "found", "bad", "discarded", "stale" ]; // note lastResult isn't updated here!
			for(var all = 0; all < names.length; all++) {
				target[names[all]].textContent = obj[names[all]][loop];
			}
			// dsps also needs special handling
			target["dsps"].textContent = obj["dsps"][loop].toPrecision(3);
			var last = obj.lastResult[loop];  // seconds since epoch
			var now = Math.floor(Date.now() / 1000.0); // the clocks could be not syncronized, we could be going in the future slightly...
			server.hw.linearDevice[loop].lastResultSSE = last < now? last : now; // .. so just lie
		}
	},
	
	refreshResultTimeElapsed: function() {
		for(var loop = 0; loop < server.hw.linearDevice.length; loop++) {
			if(presentation.noncesCells[loop] === null) continue;
			var target = presentation.noncesCells[loop].lastResult;
			if(target.childNodes.length === 0) {
				// note: not the <time> element! That element must identify a specific date in gregorian calendar.
				// I want to measure elapsed time instead, use something more generic
				var wait = document.createElement("data");
				compatible.modClass(wait, "elapsedTime", "add");
				wait.textContent = "...";
				target.appendChild(wait);
			}
				
			if(server.hw.linearDevice[loop].lastResultSSE) {
				target.firstChild.value = Math.floor(server.hw.linearDevice[loop].lastResultSSE);
				var elapsed = Date.now() - Math.floor(server.hw.linearDevice[loop].lastResultSSE) * 1000;
				target.firstChild.textContent = window.presentation.support.readableHHHHMMSS(elapsed);
			}
		}
	},
	
	refreshPoolWorkerStats: function() {
		var accepted = 0, rejected = 0, sent = 0;
		//! \todo only pool 0 supported for now, only 1 worker
		if(!server.remote || !server.remote.length) return; // happens when not hashing due to config load error
		if(server.remote[0].shares) {
			accepted = server.remote[0].shares.accepted;
			rejected = server.remote[0].shares.rejected;
			sent = server.remote[0].shares.sent;
		}
		if(sent === 0) return;
		var string = "" + accepted + "/" + sent;
		if(rejected) {
			string += " (rejected: " + Math.floor(rejected / sent * 1000) / 10 + "%)";
		}
		document.getElementById("poolNonceStats").textContent = string;
	},
	
	makeUptimeInfo: function() {
		var div = document.createElement("div");
		compatible.modClass(div, "detailsBox", "add");
		div.style.display = "none";
		div.style.zIndex = 5;
		var string = "<h3>Run time</h3>";
		string += "<strong>Since program initialized: </strong><span id='progElapsed'></span><br>";
		string += "<strong>Since hashing started: </strong><span id='hashElapsed'></span><br>";
		if(window.server.startTime.nonce) {
			string += "<strong>First nonce found:</strong> ";
			string += "" + new Date(window.server.startTime.nonce * 1000);
			string += "<br>";
		}
		div.innerHTML = string;
		div.appendChild(window.presentation.support.makeDetailShowHideButton(div, "Close"));
		window.presentation.support.makeMovable(div);
		document.getElementById("uptimebtn").appendChild(div);
		document.getElementById("uptimebtn").appendChild(window.presentation.support.makeDetailShowHideButton(div, "Details"));
		
		window.setInterval(function() {
			var now = new Date();
			var when = window.server.startTime && window.server.startTime.program;
			if(when) {
				var where = document.getElementById("progElapsed");
				where.textContent = window.presentation.support.readableHHHHMMSS(now - when * 1000);
			}
			when = window.server.startTime && window.server.startTime.hashing;
			var where = document.getElementById("hashElapsed");
			if(when) where.textContent = window.presentation.support.readableHHHHMMSS(now - when * 1000);
			else {
				compatible.modClass(where, "hugeError", "add");
				where.textContent = "!! not hashing !!";
			}
		}, 1000);
	},
	
	support: {
		extractPXMeasure: function(str) { return str.substr(0, str.length - 2); },
		makeMovable: function(div) { // Attach drag functionality
			/*! Ugly shit about browsers. Gecko has it right. It has a 'buttons' property being a bitmask of buttons pushed.
			It seems recent IE also has it. CHROME NOT.
			Ok, so the 'button' property, signal the index of the pressed button. Besides it can only signal a single button state, indices
			start at 0 so there's no way to know if no button is pressed! WTF W3C !!!
			No problem. There's .which. It's 0 if not pressed or 1+button. Firefox always sets this to 1 !!! 
			So here we go for the ugly shit that follows: register mouseup and mousedown so we know what's down and what's not. */
			var moveState = {};
			compatible.setEventCallback(div, "mousedown", function(event) {
				if(event.target !== div) return;
				if(event.button === 0) moveState.pushPoint = [ event.clientX, event.clientY ];
			}, false);
			compatible.setEventCallback(div, "mouseup", function(event) {
				// don't miss up events in contained rects (+ or -), will leave dragging state off... fairly odd to see
				if(event.target !== div && div.contains(event.target) === false) return;
				if(event.button === 0) moveState.pushPoint = undefined;
			}, false);
			compatible.setEventCallback(div, "mousemove", function(event) {
				if(!moveState.pushPoint) return;
				if(event.target !== div) return;
				var dx = event.clientX - moveState.pushPoint[0];
				var dy = event.clientY - moveState.pushPoint[1];
				var x = 1 * presentation.support.extractPXMeasure(div.style.left);
				var y = 1 * presentation.support.extractPXMeasure(div.style.top );
				div.style.left = (x + dx) + "px";
				div.style.top  = (y + dy) + "px";
				moveState.pushPoint = [ event.clientX, event.clientY ];
			}, false);
			// Is the above sufficient? Of course not! In theory if the dragging goes out of the rectangle (which is likely, as we
			// move the rectangle AFTER the mouse moved) then we have to cancel dragging operation:
			compatible.setEventCallback(div, "mouseleave", function(event) { 
				if(event.target !== div) return;
				moveState.pushPoint = undefined;
			}, false);
			// ^ this makes dragging slightly inconvenient: one might want to allow some pixels of tolerance and keep memory of the
			// dragging operation. That's not so easy as we might click on the hide button after that.
			// Mouse capture would probably be the right tool for the job here but it just doesn't seem worth the effort!
		},
		makeDetailShowHideButton: function(div, desc) {
			var btn = document.createElement("button");
			btn.textContent = desc;
			compatible.setEventCallback(btn, "click", function(click) {
				presentation.support.showHideBTNFunc(btn, div, click);
			});
			return btn;
		},
		showHideBTNFunc: function(btn, div, click) {
			if(div.style.display === "none") {
				div.style.display = "block"; // get sized bro!
				if(div.style.top === "") {
					div.style.top = (click.screenY - div.clientHeight) + "px";
					div.style.left = "50px";
				}
			}
			else div.style.display = "none";
		},
		readableHHHHMMSS: function(elapsedms) {
			var initial = elapsedms;
			var elapsed = initial;
			elapsed = Math.floor(elapsed / 1000);
			var count = Math.floor(elapsed / (60 * 60));
			var readable = "";
			if(count) {
				readable += count;
				elapsed -= count * 60 * 60;
			}
			count = Math.floor(elapsed / 60);
			if(count || readable.length) {
				if(readable.length) {
					readable += ":";
					if(elapsed < 10) readable += "0";
				}
				readable += "" + count;
				elapsed -= count * 60;
			}
			if(elapsed || readable.length) {
				if(readable.length) {
					readable += ":";
					if(elapsed < 10) readable += "0";
				}
				readable += "" + elapsed;
			}
			else if(readable.length === 0) readable = "0";
			return readable;
		}
	},
	
	imgFromCanvas: function(canvas) {
		var img = document.createElement("img");
		img.src = canvas.toDataURL();
		return img;
	},
	
	hue: function(numColors, mode, seed) {
		var distance = 360.0 / (numColors + 1);
		var ret = [];
		ret.length = numColors;
		for(var loop = 0, h = distance; loop < numColors; loop++) {
			ret[loop] = h;
			h += distance;
		}
		if(mode === "pingpong") {
			var a = 1, b = numColors - 1;
			while(a < b) {
				var t = ret[a];
				ret[a] = ret[b];
				ret[b] = t;
				a += 2;
				b -= 2;
			}
		}
		else if(mode === "unpredictable" || (mode === "random" && seed === undefined)) {
			for(var loop = 0; loop < numColors; loop++) {
				var r = Math.floor(Math.random() *  (numColors - loop));
				var t = ret[loop];
				ret[loop] = ret[r];
				ret[r] = t;
			}
		}
		else if(mode === "random") {
			throw "Todo, repeatable random (Math.random is not!)";
		}
		return ret;
	},
	hsl: function(hue, saturation, luminance) {
		if(saturation === undefined) saturation = 100;
		else saturation = Math.Max(0, Math.min(100, saturation));
		if(luminance === undefined) luminance = 50;
		else luminance = Math.Max(0, Math.min(100, luminance));
		return "hsl(" + hue + ", " + saturation +"%, " + luminance + "%)";
	},
	glyphs: "\u25a0\u25b2\u25cf\u2660\u2663\u2665\u2666\u266a\u266b\u263c\u25ca\u25ac\u2605\u2668",
	patterns: function(size, count, options) {
		if(options === undefined) options = {};
		if(options.colors === undefined) {
			var temp = this.hue(count, "pingpong");
			options.colors = [];
			for(var loop = 0; loop < count; loop++) options.colors[loop] = this.hsl(temp[loop]);
		}
		var ret = [];
		for(var loop = 0; loop < count; loop++) {
			var canvas = document.createElement("canvas");
			canvas.width = canvas.height = size;
			var paint = canvas.getContext("2d");
			paint.save();
			paint.fillStyle = options.colors[loop];
			paint.fillRect(0, 0, size, size);
			ret.push(canvas);
			
			if(options.glyphs) {
				var g = loop % options.glyphs.length;
				paint.fillStyle = "black";
				paint.font = "" + size / 1.5 + "px sans-serif";
				paint.textBaseline = "middle";
				paint.textAlign = "center";
				paint.globalCompositeOperation = "destination-out";
				var draw = options.glyphs.substr(g, 1);
				paint.fillText(draw, size / 2, size / 2);	
				paint.globalCompositeOperation = "source-over";			
			}
			paint.restore();
		}
		return ret;
	}
};
