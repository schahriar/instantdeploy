var path = require('path');
var walker = require('./src/walk.js');
var watcher = require('./src/watch.js');
var managedConnection = require('./src/connectionManager.js');
var minimatch = require("minimatch");
var Client = require('scp2').Client;
var async = require('async');
var uniq = require('lodash.uniq');
var crypto = require('crypto');

// http://blog.tompawlak.org/how-to-generate-random-values-nodejs-javascript
function randomValueHex(len) {
    return crypto.randomBytes(Math.ceil(len/2))
        .toString('hex') // convert to hexadecimal format
        .slice(0,len);   // return required number of characters
}

function matchMaker(base, patterns) {
	// Inspired by https://github.com/joshwnj/minimatch-all/blob/master/index.js
	var doesMatch = false;
	patterns.forEach(function(pattern){
		// Only Look for Exclusions
		if((pattern[0] !== '!') !== doesMatch) return;
		
		doesMatch = minimatch(base, pattern);
	})
	return doesMatch;
}

var InstaDeploy = function (remoteArray, options) {
	var context = this;
	
	/*
		OPTIONS
		▬▬▬▬▬▬▬
		maxConcurrentConnections:   <Number> 5,
		maxConcurrentFiles:         <Number> 10,
		queueTime:                  <Time:MS> 3000,
		ignoreFolders:              <Array> ['.git', 'node_modules'],
		ignoreFiles:                <Array> ['.*']
		
	*/
	context.options = options || {};
	context.clientInstances = {};
	// Smart Queue Prevents multiple uploads of the same file
	// by removing duplicates within a time frame
	context.smartQueueList = [];
	context.smartQueueTimeFrame;
	
	context.smartQueueFlush = function() {
		// Remove Duplicates (reverse to select from the end)
		uniq(context.smartQueueList.reverse(), 'remotePath').forEach(function(item) {
			context.queue.push(item, item.callback);
		})
		// Reset SmartQueue
		context.smartQueueList = [];
	}
	
	// Push New instances of scp2 for every remote server provided
	if(remoteArray) remoteArray.forEach(function(remote) {
		if(!remote.name) remote.name = randomValueHex(8);
		managedConnection(context.clientInstances[remote.name], remote);
	})
	// Create an Async queue for uploads
	context.queue = async.queue(function (file, callback) {
		var parallelExecutionArray = [];
		for(var name in context.clientInstances) { 
			parallelExecutionArray.push(function(callback){
				if(context.clientInstances[name]) context.clientInstances[name].upload(file.localPath, file.remotePath, function(error){
					if(!error) console.log("UPLOADED", file);
					callback();
				});
				else callback(new Error("Connection instance not found!"));
			});
		}
		async.parallelLimit(parallelExecutionArray, context.options.maxConcurrentConnections || 5, callback);
	}, context.options.maxConcurrentFiles || 10);
}

InstaDeploy.prototype.watch = function(directoryPath, remotePath) {
	var context = this;
	walker(directoryPath, function WALKER_ON_FILE(error, directPath, relativePath, stats) {
		// FILE FUNCTION
		/* Add Ignore Options here */
		watcher(directPath, function FILE_ON_CHANGE(event, fileName) {
			clearTimeout(context.smartQueueTimeFrame);
			context.smartQueueTimeFrame = setTimeout(function(){
				context.smartQueueFlush();
			}, context.options.queueTime || 3000);
			/* Implement a rename function */
			context.smartQueueList.push({ localPath: directPath, remotePath: path.join(remotePath, relativePath), callback: function(error){
				if(!error) console.log("DONE", directPath, path.join(remotePath, relativePath));
			}});
		});
	}, function WALKER_ON_DIRECTORY(error, directPath, relativePath, callback) {
		// DIRECTORY FUNCTION
		callback();
	}, function WALKER_DONE() {
		// DONE FUNCTION
		
	})
}

module.exports = InstaDeploy;