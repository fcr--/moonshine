/**
 * @fileOverview Debug engine.
 *
 * Icons from Fugue icon set by Yusuke Kamiyamane (http://p.yusukekamiyamane.com).
 *
 * @author <a href="mailto:paul.cuthbertson@gamesys.co.uk">Paul Cuthbertson</a>
 * @copyright Gamesys Limited 2013
 * @todo Refactor the entirety of this.
 */


var shine = shine || {};




shine.debug = new shine.EventEmitter();


shine.debug.AUTO_STEP_DELAY = 500;



shine.debug._init = function () {

	this._ready = false;
	this._loadQueue = [];
	this._active = true;
	this._stepping = false;
	this._breakpoints = {};
	this._stopAtBreakpoints = true;
	this._loaded = {};
	this._resumeStack = [];
	this._callbackQueue = [];
	this._errorLog = [];
	this._status = 'running';


	if (window.sessionStorage) {
		this._breakpoints = JSON.parse(window.sessionStorage.getItem('breakpoints') || '{}'),
		this._stopAtBreakpoints = (window.sessionStorage.getItem('stopAtBreakpoints') == 'true');
		if (this._stopAtBreakpoints === null) this._stopAtBreakpoints = true;

		this._trigger('breakpoints-updated', [this._breakpoints]);
		this._trigger('stop-at-breakpoints-updated', [this._stopAtBreakpoints]);
	}
};



	
shine.debug._clearLoadQueue = function () {
	this._ready = true;

	while (this._loadQueue.length) {
		var data = this._loadQueue.pop();
		data[0].load.apply(data[0], data[1]);
	}
};




shine.debug._formatValue = function (val) {
	var result, fields, i;

	switch(true) {
		case typeof val == 'number':
			return val;

		case val && val instanceof shine.Table:
			result = {
				caption: shine.utils.coerce(val, 'string')
			};

			fields = {};

			for (i in val) {
				if (val.hasOwnProperty(i) && i != '__shine') fields[i] = typeof val[i] == 'number'? val[i] : shine.utils.coerce(val[i], 'string');
			}

			result.fields = fields;
			return result;

		default:
			return shine.utils.coerce(val, 'string');
	}			
};




shine.debug._getSuspendedGlobals = function () {
	var globals = this._resumeStack[0]._globals,
		result = {},
		i, val;

	for (i in globals) {
		if (globals.hasOwnProperty(i)) {
			val = globals[i];
			if (globals.hasOwnProperty(i) && i != '_G' && i != '__shine') result[i] = this._formatValue(val);
		}
	}

	return result;
};




shine.debug._getSuspendedLocals = function () {
	var closure = this._resumeStack[0],
		result = {},
		index = 0,
		i, local, pc, val;

	for (i in closure._data.locals) {
		if (closure._data.locals.hasOwnProperty(i)) {
			local = closure._data.locals[i];
			pc = closure._pc + 1;
				
			if (local.startpc < pc && local.endpc >= pc) {
				val = closure._register.getItem(index++);
				result[local.varname] = this._formatValue(val);
			}
		}
	}

	return result;
};




shine.debug._getSuspendedUpvalues = function () {
	var closure = this._resumeStack[0],
		result = {},
		i, up, val;

	for (i in closure._upvalues) {
		if (closure._upvalues.hasOwnProperty(i)) {
			up = closure._upvalues[i];
			val = up.getValue();
			result[up.name] = this._formatValue(val);
		}
	}

	return result;
};




shine.debug._getSuspendedCallStack = function () {
	var result = [],
		stack = this._resumeStack,
		closure,
		i, l,
		offset = 0;

	for (i = 0, l = stack.length; i < l; i++) {
		closure = stack[i];
		if (closure instanceof shine.Closure) {
			result.push([closure, closure._pc + offset]);
			offset = -1;
		}
	}

	result = shine.Error.prototype._stackToString.call({ luaStack: result }).replace('    ', '').split('\n');
	return result;
};




shine.debug.getCurrentState = function () {
	return {
		loaded: this._loaded,
		breakpoints: this._breakpoints,
		stopAtBreakpoints: this._stopAtBreakpoints,
		errorLog: this._errorLog,
		engine: {
			state: this._status,
			data: this._statusData
		}
	}
};




shine.debug.handleFileLoaded = function (file, callback) {
	var debug = this,
		jsonUrl = file.url,
		pathData,
		url,
		sourcePath = file.data.sourcePath;

	if (sourcePath) {
		pathData = (jsonUrl || '').match(/^(.*)\/.*?$/);
		pathData = (pathData && pathData[1]) || '';

		url = pathData + '/' + sourcePath;
		url = url.replace(/\/\.\//g, '/').replace(/\/.*?\/\.\.\//g, '/');

	} else {
		url = jsonUrl.replace (/(.lua)?.json$/, '.lua');
	}

	this._breakpoints[jsonUrl] = this._breakpoints[jsonUrl] || [];

	function success (data) {
		debug._loaded[jsonUrl] = {
			filename: url,
			source: data
		};

		debug._trigger('lua-loaded', [jsonUrl, url, data]);
		callback();
	}

	function error (e) {
		debug._loaded[jsonUrl] = {
			filename: url,
			source: false
		};

		debug._trigger('lua-load-failed', [jsonUrl, url, e]);
		callback();
	}
	
	shine.utils.get(url, success, error);
};




shine.debug.loadScript = function (jsonUrl, sourceUrl) {
	var pathData,
		url, 
		debug = this;

	if (sourceUrl) {
		pathData = (jsonUrl || '').match(/^(.*\/).*?$/),
		pathData = (pathData && pathData[1]) || '';
		url = pathData + sourceUrl;

	} else {
		url = jsonUrl.replace(/(.lua)?.json$/, '.lua');
	}

};

	


shine.debug.toggleBreakpoint = function (jsonUrl, lineNumber) {
	if (this._breakpoints[jsonUrl] === undefined) this._breakpoints[jsonUrl] = [];

	var fileBreakpoints = this._breakpoints[jsonUrl],
		breakOn = fileBreakpoints[lineNumber] = !fileBreakpoints[lineNumber];

	if (window.sessionStorage) window.sessionStorage.setItem('breakpoints', JSON.stringify(this._breakpoints));
	this._trigger('breakpoint-updated', [jsonUrl, lineNumber, breakOn]);

	if (breakOn && !this._stopAtBreakpoints) this.toggleStopAtBreakpoints();
};




shine.debug.toggleStopAtBreakpoints = function () {
	var stop = this._stopAtBreakpoints = !this._stopAtBreakpoints;
	
	window.sessionStorage.setItem('stopAtBreakpoints', stop);
	this._trigger('stop-at-breakpoints-updated', [stop]);
};




shine.debug._setStatus = function (status, data) {
	data = data || {};
	this._status = status;

	var me = this;

	switch (status) {
		case 'suspended':
			data.globals = this._getSuspendedGlobals();
			data.locals = this._getSuspendedLocals();
			data.upvalues = this._getSuspendedUpvalues();
			data.callStack = this._getSuspendedCallStack();

			if (this._autoStepping) {
				window.setTimeout(function () {
					me.stepIn();
				}, this.AUTO_STEP_DELAY);
			}
			break;
	}

	this._statusData = data;
	this._trigger('state-updated', [status, data]);
}




shine.debug.autoStep = function () {
	if (this._autoStepping = !this._autoStepping) this.stepIn();
};




shine.debug.stepIn = function () {
	this._stepping = true;
	delete this._steppingTo;
	this._resumeThread();
};




shine.debug.stepOver = function () {
	this._stepping = true;
	this._autoStepping = false;
	this._steppingTo = this._resumeStack[0];
	this._resumeThread();
};




shine.debug.stepOut = function () {
	if (this._resumeStack.length < 2) return this.resume();
	
	var target,
		i = 1;

	// do {
		target = this._resumeStack[i++];
	// } while (target !== undefined && !(target instanceof shine.Closure));

	// if (!target) return this.resume();

	this._steppingTo = target;
	this._stepping = true;
	this._autoStepping = false;
	this._resumeThread();
};




shine.debug.resume = function () {
	this._stepping = false;
	this._autoStepping = false;
	delete this._steppingTo;
	this._resumeThread();

	this._trigger('resumed');
};




shine.debug.pause = function () {
	this._setStatus('suspending');
	this._stepping = true;
};







(function () {
	
	
	var load = shine.VM.prototype.load;
	
	shine.VM.prototype.load = function (url, execute, coConfig) {
		var args = arguments;

		if (!shine.debug._ready) {
			shine.debug._loadQueue.push([this, arguments]);
		} else {
			// shine.debug.handleFileLoaded(url, function () {
				load.apply(this, args);
			// });
		}
	};




	shine.FileManager.prototype._onFileLoaded = function (file, callback) {
		var me = this;

		shine.debug.handleFileLoaded(file, function () {
			callback(null, file);
		});
	};




	var execute = shine.Closure.prototype.execute;

	shine.Closure.prototype.execute = function () {
		var me = this,
			args = arguments;
		
		if (shine.debug._status != 'running') {
			shine.debug._callbackQueue.push(function () {

			try {
				me.execute.apply(me, args);
			
			} catch (e) {
				if (!((e || shine.EMPTY_OBJ) instanceof shine.Error)) {
					var stack = (e.stack || '');

					e = new shine.Error ('Error in host call: ' + e.message);
					e.stack = stack;
					e.luaStack = stack.split ('\n');
				}

				if (!e.luaStack) e.luaStack = shine.gc.createArray();
				e.luaStack.push([me, me._pc - 1]);

				shine.Error.catchExecutionError(e);
			}

			});
		} else {
			return execute.apply(this, arguments);
		}
	};
	
	
	

	var executeInstruction = shine.Closure.prototype._executeInstruction;
	
	shine.Closure.prototype._executeInstruction = function (pc, lineNumber) {
		var debug = shine.debug,
			jsonUrl = this._file.url,
			opcode = this._instructions[pc * 4];

		if ((
				(debug._stepping && (!debug._steppingTo || debug._steppingTo == this)) || 			// Only break if stepping in, out or over  
				(debug._stopAtBreakpoints && debug._breakpoints[jsonUrl][lineNumber - 1])			// or we've hit a breakpoint.
			) &&		
			!debug._resumeStack.length && 															// Don't break if we're in the middle of resuming from the previous debug step.
			lineNumber != debug._currentLine && 													// Don't step more than once per line.
			[35, 36].indexOf(opcode) < 0 && 														// Don't break on closure declarations.
			!(shine.Coroutine._running && shine.Coroutine._running.status == 'resuming')) {			// Don't break while a coroutine is resuming.

				// Break execution

				debug._setStatus('suspending');
				debug._currentFileUrl = jsonUrl;
				debug._currentLine = lineNumber;
				this._pc--;


				window.setTimeout (function () { 
					debug._setStatus('suspended', { url: jsonUrl, line: lineNumber });
					// debug._trigger('suspended', );
				}, 1);

				return;
		}


		debug._lastFileUrl = jsonUrl;
		debug._lastLine = lineNumber;


		try {
			var result = executeInstruction.apply(this, arguments);

		} catch (e) {
			if (e instanceof shine.Error) {
				if (!e.luaStack) e.luaStack = [];

				var message = 'at ' + (this._data.sourceName || 'function') + ' on line ' + this._data.linePositions[this._pc - 1];	
				// if (message != e.luaStack[e.luaStack.length - 1]) e.luaStack.push(message);
			} 
	
			throw e;
		}

		if ([30, 35].indexOf(opcode) >= 0) {	// If returning from or closing a function call, step out = step over = step in
			delete debug._steppingTo;
		}

		return result;
	};




	var error = shine.Error,
		errors = [];
	 
	shine.Error = function (message) {
		this._debugData = {
			jsonUrl: shine.debug._lastFileUrl,
			lineNumber: shine.debug._lastLine,
			message: message
		};

		this._debugIndex = errors.length;
		errors[this._debugIndex] = this;

		error.apply(this, [message + ' [shine.Error:' + this._debugIndex + ']']);
	};
	
	shine.Error.prototype = error.prototype;
	shine.Error.catchExecutionError = error.catchExecutionError;	




	var onerror = window.onerror;

	window.onerror = function (message) { 		// Note: window.addEventListener does not supply error info in Firefox.
		var match = message.match(/\[shine.Error:(\d+)\]/),
			index, data;

		if (match) {
			index = parseInt(match[1], 10);
			data = errors[index]._debugData;

			shine.debug._errorLog.push(data);
			shine.debug._trigger('error', [data]);
		}

		if (onerror) return onerror.apply(this, arguments);
		return false;
	};


})();





shine.debug._resumeThread = function () {
	this._setStatus('resuming');

	var f = this._resumeStack.pop();

	if (f) {
		try {
			if (f instanceof shine.Coroutine) {
				f.resume();
			} else {
				f._run();
			}
			
		} catch (e) {
			if (!((e || shine.EMPTY_OBJ) instanceof shine.Error)) {
				var stack = (e.stack || '');

				e = new shine.Error ('Error in host call: ' + e.message);
				e.stack = stack;
				e.luaStack = stack.split ('\n');
			}

			if (!e.luaStack) e.luaStack = shine.gc.createArray();
			e.luaStack.push([f, f._pc - 1]);

			shine.Error.catchExecutionError(e);
		}
	}
	
	// if (this._status == 'running') this._trigger('running');
	while (this._callbackQueue[0]) this._callbackQueue.shift()();
};




shine.debug._init ();







////////////////
//  Local UI  //
////////////////


shine.debug.ui = {

	init: function () {

		var me = this,
			iframe = this.iframe = document.createElement('iframe');

		iframe.src = '../debug/ui/index.html';
		iframe.style.position = 'fixed';
		iframe.style.top = '0';
		iframe.style.right = '20px';
		iframe.style.width = '232px';
		iframe.style.height = '30px';
		iframe.style.overflow = 'hidden';
		iframe.style.border = 'none';

		// window.addEventListener('load', function () {
			document.body.appendChild(iframe);

			iframe.contentWindow.addEventListener('load', function () {
				me._initIFrame(iframe);
			});			
		// });

	},




	_initIFrame: function (iframe) {
		var doc = iframe.contentDocument,
			toggle = document.createElement('button');

		// Toggle size;
		toggle.className = 'toggle';
		toggle.title = 'Toggle size';
		toggle.textContent = 'Size';


		function toggleExpanded () {
			var expand = toggle.className == 'toggle';

			if (expand) {
				iframe.style.width = '50%';
				iframe.style.right = '0';
				iframe.style.height = '100%';
				toggle.className = 'toggle expanded';

			} else {
				iframe.style.right = '20px';
				iframe.style.width = '232px';
				iframe.style.height = '30px';
				toggle.className = 'toggle';
			}

			if (sessionStorage) sessionStorage.setItem('expanded', expand? '1' : '');
		}

		toggle.addEventListener('click', toggleExpanded);	
		if (sessionStorage && sessionStorage.getItem('expanded')) toggleExpanded();


		iframe.contentDocument.querySelector('.buttons').appendChild(toggle);
		iframe.contentWindow.registerDebugEngine(shine.debug);
		shine.debug._clearLoadQueue();
	},

};


// Give time for the ui to be overridden
window.addEventListener('load', function () { shine.debug.ui.init(); });



