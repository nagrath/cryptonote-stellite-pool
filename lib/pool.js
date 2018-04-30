var fs = require('fs');
var net = require('net');
var tls = require('tls');
var crypto = require('crypto');

var async = require('async');
var bignum = require('bignum');

var cryptonight_variant = require('multi-hashing')['cryptonight_variant'];
var cryptonight_v4 = require('cryptonight-hashing')['cryptonight'];

var dateFormat = require('dateformat');
var emailSystem = require('./email.js');

// Must exactly be 8 hex chars
var noncePattern = new RegExp("^[0-9A-Fa-f]{8}$");

var threadId = '(Thread ' + process.env.forkId + ') ';

var logSystem = 'pool';
require('./exceptionWriter.js')(logSystem);

var apiInterfaces = require('./apiInterfaces.js')(global.config.daemon, global.config.wallet, global.config.api);

var utils = require('./utils.js');

Buffer.prototype.toByteArray = function () {
    return Array.prototype.slice.call(this, 0);
}

var Miner = require('./miner.js');

var log = function(severity, system, text, data){
    global.log(severity, system, threadId + text, data);
};

var diff1 = bignum('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF', 16);

var instanceId = crypto.randomBytes(4);

var validBlockTemplates = [];
var currentBlockTemplate;

// Vars for slush mining
var scoreTime;
var lastChecked = 0;

var poolStarted = false;
var connectedMiners = {};
var connectedWorkers = {};

var bannedIPs = {};
var perIPStats = {};

var shareTrustStepFloat = global.config.poolServer.shareTrust.enabled ? global.config.poolServer.shareTrust.stepDown / 100 : 0;
var shareTrustMinFloat = global.config.poolServer.shareTrust.enabled ? global.config.poolServer.shareTrust.min / 100 : 0;

/* Variable difficulty retarget */
setInterval(function(){
    var now = Date.now() / 1000 | 0;
    for (var minerId in connectedMiners){
        var miner = connectedMiners[minerId];
        if(!miner.noRetarget) {
            miner.retarget(now);
        }
    }
}, global.config.poolServer.varDiff.retargetTime * 1000);


/* Every 30 seconds clear out timed-out miners and old bans */
setInterval(function(){
    var now = Date.now();
    var timeout = global.config.poolServer.minerTimeout * 1000;
    for (var minerId in connectedMiners){
        var miner = connectedMiners[minerId];
        if (now - miner.lastBeat > timeout){
            log('warn', logSystem, 'Miner timed out and disconnected %s@%s', [miner.login, miner.ip]);
            delete connectedMiners[minerId];
            removeConnectedWorker(miner, 'timeout');
        }
    }    

    if (global.config.poolServer.banning.enabled){
        for (ip in bannedIPs){
            var banTime = bannedIPs[ip];
            if (now - banTime > global.config.poolServer.banning.time * 1000) {
                delete bannedIPs[ip];
                delete perIPStats[ip];
                log('info', logSystem, 'Ban dropped for %s', [ip]);
            }
        }
    }

}, 30000);


process.on('message', function(message) {
    switch (message.type) {
        case 'banIP':
            bannedIPs[message.ip] = Date.now();
            break;
    }
});


function IsBannedIp(ip){
    if (!global.config.poolServer.banning.enabled || !bannedIPs[ip]) return false;

    var bannedTime = bannedIPs[ip];
    var bannedTimeAgo = Date.now() - bannedTime;
    var timeLeft = global.config.poolServer.banning.time * 1000 - bannedTimeAgo;
    if (timeLeft > 0){
        return true;
    }
    else {
        delete bannedIPs[ip];
        log('info', logSystem, 'Ban dropped for %s', [ip]);
        return false;
    }
}


function BlockTemplate(template){
    this.blob = template.blocktemplate_blob;
    this.difficulty = template.difficulty;
    this.height = template.height;
    this.reserveOffset = template.reserved_offset;
    this.buffer = new Buffer(this.blob, 'hex');
    instanceId.copy(this.buffer, this.reserveOffset + 4, 0, 3);
    this.previous_hash = new Buffer(32);
    this.buffer.copy(this.previous_hash,0,7,39);
    this.extraNonce = 0;
}
BlockTemplate.prototype = {
    nextBlob: function(){
        this.buffer.writeUInt32BE(++this.extraNonce, this.reserveOffset);
        return utils.cnUtil.convert_blob(this.buffer).toString('hex');
    }
};


function getBlockTemplate(callback){
    apiInterfaces.rpcDaemon('getblocktemplate', {reserve_size: 8, wallet_address: global.config.poolServer.poolAddress}, callback);
}


function jobRefresh(loop, callback){
    callback = callback || function(){};
    getBlockTemplate(function(error, result){
        if (loop)
            setTimeout(function(){
                jobRefresh(true);
            }, global.config.poolServer.blockRefreshInterval);
        if (error){
            log('error', logSystem, 'Error polling getblocktemplate %j', [error]);
            if (!poolStarted) log('error', logSystem, 'Could not start pool');
            callback(false);
            return;
        }
        var buffer = new Buffer(result.blocktemplate_blob, 'hex');
        var previous_hash = new Buffer(32);
        buffer.copy(previous_hash,0,7,39);
        if (!currentBlockTemplate || previous_hash.toString('hex') !== currentBlockTemplate.previous_hash.toString('hex')){
            log('info', logSystem, 'New block to mine at height %d w/ difficulty of %d', [result.height, result.difficulty]);
            processBlockTemplate(result);
        }
        if (!poolStarted) {
            startPoolServerTcp(function(successful){ poolStarted = true });
        }
        callback(true);
    })
}


function processBlockTemplate(template){
    if (currentBlockTemplate)
        validBlockTemplates.push(currentBlockTemplate);

    if (validBlockTemplates.length > 3)
        validBlockTemplates.shift();

    currentBlockTemplate = new BlockTemplate(template);

    for (var minerId in connectedMiners){
        var miner = connectedMiners[minerId];
        miner.pushMessage('job', miner.getJob(currentBlockTemplate,diff1));
    }
}


(function init(){
    jobRefresh(true, function(sucessful){ });
})();



function newConnectedWorker(miner){
    log('info', logSystem, 'Miner connected %s@%s on port', [miner.login, miner.ip, miner.port]);
    if (miner.workerName !== 'undefined') log('info', logSystem, 'Worker Name: %s', [miner.workerName]);
    if (miner.email) log('info', logSystem, 'E-Mail Address: %s', [miner.email]);
    if (miner.difficulty) log('info', logSystem, 'Miner difficulty fixed to %s', [miner.difficulty]);

    if (!connectedWorkers[miner.workerName]) connectedWorkers[miner.workerName] = 0;
    connectedWorkers[miner.workerName]++;

    redisClient.sadd([global.config.coin + ':workers_ip:' + miner.login, miner.ip]);
    redisClient.hincrby([global.config.coin + ':ports:'+miner.port, 'users', '1']);

    if (miner.email && connectedWorkers[miner.workerName] === 1) {
        emailSystem.sendEmail(
            miner.email,
            'Worker %WORKER_NAME% connected',
            'worker_connected',
            {'WORKER_NAME': miner.workerName !== 'undefined' ? miner.workerName : ''}
        );
    }
}

function removeConnectedWorker(miner, reason){
    if (!connectedWorkers[miner.workerName]) connectedWorkers[miner.workerName] = 0;
    if (connectedWorkers[miner.workerName] > 0) connectedWorkers[miner.workerName]--;
    if (connectedWorkers[miner.workerName] <= 0) delete connectedWorkers[miner.workerName];

    redisClient.hincrby([global.config.coin + ':ports:'+miner.port, 'users', '-1']);

    if (miner.email) {
        if (reason === 'banned') {
            emailSystem.sendEmail(
                this.email,
                'Worker %WORKER_NAME% banned',
                'worker_banned',
                {'WORKER_NAME': this.workerName !== 'undefined' ? this.workerName : ''}
            );
        } else if (!connectedWorkers[miner.workerName]) {
            emailSystem.sendEmail(
                miner.email,
                'Worker %WORKER_NAME% stopped hashing',
                'worker_timeout',
                {'WORKER_NAME': miner.workerName !== 'undefined' ? miner.workerName : '',
                 'LAST_HASH': dateFormat(new Date(miner.lastBeat), 'yyyy-mm-dd HH:MM:ss Z')}
            );
        }        
    }
}



function recordShareData(miner, job, shareDiff, blockCandidate, hashHex, shareType, blockTemplate){

    var dateNow = Date.now();
    var dateNowSeconds = dateNow / 1000 | 0;

    // Weighting older shares lower than newer ones to prevent pool hopping
    if (global.config.poolServer.slushMining.enabled) {                
        if (lastChecked + global.config.poolServer.slushMining.lastBlockCheckRate <= dateNowSeconds || lastChecked === 0) {
            redisClient.hget(global.config.coin + ':stats', 'lastBlockFound', function(error, result) {
                if (error) {
                    log('error', logSystem, 'Unable to determine the timestamp of the last block found');
                    return;
                }
                scoreTime = result / 1000 | 0; //scoreTime could potentially be something else than the beginning of the current round, though this would warrant changes in api.js (and potentially the redis db)
                lastChecked = dateNowSeconds;
            });
        }
        
        job.score = job.difficulty * Math.pow(Math.E, ((dateNowSeconds - scoreTime) / global.config.poolServer.slushMining.weight)); // Score Calculation
        log('info', logSystem, 'Submitted score ' + job.score + ' with difficulty ' + job.difficulty + ' and the time ' + scoreTime);
    }
    else {
        job.score = job.difficulty;
    }

    var cleanupInterval = global.config.redis.cleanupInterval;
    
    var redisCommands = [
        ['hincrby', global.config.coin + ':shares:roundCurrent', miner.login, job.score],
        ['zadd', global.config.coin + ':hashrate', dateNowSeconds, [job.difficulty, miner.login, dateNow].join(':')],
        ['hincrby', global.config.coin + ':workers:' + miner.login, 'hashes', job.difficulty],
        ['hset', global.config.coin + ':workers:' + miner.login, 'lastShare', dateNowSeconds],
        ['expire', global.config.coin + ':workers:' + miner.login, (86400 * cleanupInterval)],
        ['expire', global.config.coin + ':payments:' + miner.login, (86400 * cleanupInterval)]
    ];

    if (miner.workerName) {
        redisCommands.push(['zadd', global.config.coin + ':hashrate', dateNowSeconds, [job.difficulty, miner.login + '+' + miner.workerName, dateNow].join(':')]);
        redisCommands.push(['hincrby', global.config.coin + ':unique_workers:' + miner.login + '+' + miner.workerName, 'hashes', job.difficulty]);
        redisCommands.push(['hset', global.config.coin + ':unique_workers:' + miner.login + '+' + miner.workerName, 'lastShare', dateNowSeconds]);
        redisCommands.push(['expire', global.config.coin + ':unique_workers:' + miner.login + '+' + miner.workerName, (86400 * cleanupInterval)]);
    }
    
    if (blockCandidate){
        redisCommands.push(['hset', global.config.coin + ':stats', 'lastBlockFound', Date.now()]);
        redisCommands.push(['rename', global.config.coin + ':shares:roundCurrent', global.config.coin + ':shares:round' + job.height]);
        redisCommands.push(['hgetall', global.config.coin + ':shares:round' + job.height]);
    }

    redisClient.multi(redisCommands).exec(function(err, replies){
        if (err){
            log('error', logSystem, 'Failed to insert share data into redis %j \n %j', [err, redisCommands]);
            return;
        }
        if (blockCandidate){
            var workerShares = replies[replies.length - 1];
            var totalShares = Object.keys(workerShares).reduce(function(p, c){
                return p + parseInt(workerShares[c])
            }, 0);
            redisClient.zadd(global.config.coin + ':blocks:candidates', job.height, [
                hashHex,
                Date.now() / 1000 | 0,
                blockTemplate.difficulty,
                totalShares
            ].join(':'), function(err, result){
                if (err){
                    log('error', logSystem, 'Failed inserting block candidate %s \n %j', [hashHex, err]);
                }
            });
            redisClient.hgetall(global.config.coin + ':notifications', function(error, data) {
                if (error || !data) return ;

                for (var address in data) {
                    var email = data[address];    
                    emailSystem.sendEmail(
                        email,
                        'Block %HEIGHT% found !',
                        'block_found',
                        {
                            'HEIGHT': job.height,
                            'TIME': dateFormat(Date.now(), 'yyyy-mm-dd HH:MM:ss Z'),
                            'HASH': hashHex,
                            'DIFFICULTY': blockTemplate.difficulty,
                            'SHARES': totalShares
                        }
                    );
                }
            });
        }

    });

    log('info', logSystem, 'Accepted %s share at difficulty %d/%d from %s@%s', [shareType, job.difficulty, shareDiff, miner.login, miner.ip]);
}

function processShare(miner, job, blockTemplate, nonce, resultHash){
    var template = new Buffer(blockTemplate.buffer.length);
    blockTemplate.buffer.copy(template);
    template.writeUInt32BE(job.extraNonce, blockTemplate.reserveOffset);
    var shareBuffer = utils.cnUtil.construct_block_blob(template, new Buffer(nonce, 'hex'));

    var convertedBlob;
    var hash;
    var shareType=null;

    if (global.config.poolServer.shareTrust.enabled && miner.trust.threshold <= 0 && miner.trust.penalty <= 0 && Math.random() > miner.trust.probability){
        hash = new Buffer(resultHash, 'hex');
        shareType = 'trusted';
    }
    else {
        
        convertedBlob = utils.cnUtil.convert_blob(shareBuffer);
        //stellite's variant
        var cn_variant = convertedBlob[0] >= 3 ? convertedBlob[0] - 2 : false;
        hash = (global.config.v4enabled)?cryptonight_v4(convertedBlob, cn_variant):cryptonight_variant(convertedBlob, cn_variant);
        shareType = 'valid';
        
    }

    if (hash.toString('hex') !== resultHash) {
        miner.sendReply("Incorrect algorithm.");
        log('warn', logSystem, 'Bad algorithm from miner %s@%s', [miner.login, miner.ip]);
        return false;
    }

    var hashArray = hash.toByteArray().reverse();
    var hashNum = bignum.fromBuffer(new Buffer(hashArray));
    var hashDiff = diff1.div(hashNum);

    if (hashDiff.ge(blockTemplate.difficulty)){

        apiInterfaces.rpcDaemon('submitblock', [shareBuffer.toString('hex')], function(error, result){
            if (error){
                log('error', logSystem, 'Error submitting block at height %d from %s@%s, share type: "%s" - %j', [job.height, miner.login, miner.ip, shareType, error]);
                recordShareData(miner, job, hashDiff.toString(), false, null, shareType);
            }
            else{
                var blockFastHash = utils.cnUtil.get_block_id(shareBuffer).toString('hex');
                log('info', logSystem,
                    'Block %s found at height %d by miner %s@%s - submit result: %j',
                    [blockFastHash.substr(0, 6), job.height, miner.login, miner.ip, result]
                );
                recordShareData(miner, job, hashDiff.toString(), true, blockFastHash, shareType, blockTemplate);
                jobRefresh();
            }
        });
    }else if (hashDiff.lt(job.difficulty)){
        log('warn', logSystem, 'Rejected low difficulty share of %s from %s@%s', [hashDiff.toString(), miner.login, miner.ip]);
        return false;
    }else{
        recordShareData(miner, job, hashDiff.toString(), false, null, shareType);
    }

    return true;
}


function handleMinerMethod(method, params, ip, portData, sendReply, pushMessage){
    var miner = connectedMiners[params.id];

    // Check for ban here, so preconnected attackers can't continue to screw you
    if (IsBannedIp(ip)){
        sendReply('Your IP is banned');
        return;
    }

    switch(method){
        case 'login':
            
            
            miner = new Miner(params, pushMessage,sendReply);
            if(!miner.setParams(params)){
                return;
            }
            
            if(miner.difficulty === 0){
                var difficulty = portData.difficulty;
                miner.difficulty = difficulty;
            }

            miner.ip = ip;

            miner.port = portData.port;

            miner.heartbeat();

            connectedMiners[miner.id] = miner;
            
            sendReply(null, {
                id: miner.id,
                job: miner.getJob(currentBlockTemplate,diff1),
                status: 'OK'
            });

            newConnectedWorker(miner);

            break;
        case 'getjob':
            if (!miner){
                sendReply('Unauthenticated');
                return;
            }
            miner.heartbeat();
            sendReply(null, miner.getJob(currentBlockTemplate,diff1));
            break;
        case 'submit':
            if (!miner){
                sendReply('Unauthenticated');
                return;
            }
            miner.heartbeat();

            var job = miner.validJobs.filter(function(job){
                return job.id === params.job_id;
            })[0];

            if (!job){
                sendReply('Invalid job id');
                return;
            }

            if (!noncePattern.test(params.nonce)) {
                var minerText = miner ? (' ' + miner.login + '@' + miner.ip) : '';
                log('warn', logSystem, 'Malformed nonce: ' + JSON.stringify(params) + ' from ' + minerText);
                perIPStats[miner.ip] = { validShares: 0, invalidShares: 999999 };
                miner.checkBan(false,perIPStats);
                sendReply('Duplicate share');
                return;
            }

            // Force lowercase for further comparison
            params.nonce = params.nonce.toLowerCase();

            if (job.submissions.indexOf(params.nonce) !== -1){
                var minerText = miner ? (' ' + miner.login + '@' + miner.ip) : '';
                log('warn', logSystem, 'Duplicate share: ' + JSON.stringify(params) + ' from ' + minerText);
                perIPStats[miner.ip] = { validShares: 0, invalidShares: 999999 };
                miner.checkBan(false,perIPStats);
                sendReply('Duplicate share');
                return;
            }

            job.submissions.push(params.nonce);

            var blockTemplate = currentBlockTemplate.height === job.height ? currentBlockTemplate : validBlockTemplates.filter(function(t){
                return t.height === job.height;
            })[0];

            if (!blockTemplate){
                sendReply('Block expired');
                return;
            }

            var shareAccepted = processShare(miner, job, blockTemplate, params.nonce, params.result,sendReply);
            miner.checkBan(shareAccepted,perIPStats);
            
            if (global.config.poolServer.shareTrust.enabled){
                if (shareAccepted){
                    miner.trust.probability -= shareTrustStepFloat;
                    if (miner.trust.probability < shareTrustMinFloat)
                        miner.trust.probability = shareTrustMinFloat;
                    miner.trust.penalty--;
                    miner.trust.threshold--;
                }else{
                    log('warn', logSystem, 'Share trust broken by %s@%s', [miner.login, miner.ip]);
                    miner.trust.probability = 1;
                    miner.trust.penalty = global.config.poolServer.shareTrust.penalty;
                }
            }
            
            if (!shareAccepted){
                return;
            }

            var now = Date.now() / 1000 | 0;
            miner.shareTimeRing.append(now - miner.lastShareTime);
            miner.lastShareTime = now;
            //miner.retarget(now);

            sendReply(null, {status: 'OK'});
            break;
        case 'keepalived' :
            if (!miner){
                sendReply('Unauthenticated');
                return;
            }
            miner.heartbeat();
            sendReply(null, { status:'KEEPALIVED' });
            break;
        default:
            sendReply('Invalid method');
            var minerText = miner ? (' ' + miner.login + '@' + miner.ip) : '';
            log('warn', logSystem, 'Invalid method: %s (%j) from %s', [method, params, minerText]);
            break;
    }
}


var httpResponse = ' 200 OK\nContent-Type: text/plain\nContent-Length: 20\n\nmining server online';

function startPoolServerTcp(callback){
    async.each(global.config.poolServer.ports, function(portData, cback){
        var handleMessage = function(socket, jsonData, pushMessage){
            if (!jsonData.id) {
                log('warn', logSystem, 'Miner RPC request missing RPC id');
                return;
            }
            else if (!jsonData.method) {
                log('warn', logSystem, 'Miner RPC request missing RPC method');
                return;
            } 
            else if (!jsonData.params) {
                log('warn', logSystem, 'Miner RPC request missing RPC params');
                return;
            }

            var sendReply = function(error, result){
                if(!socket.writable) return;
                var sendData = JSON.stringify({
                    id: jsonData.id,
                    jsonrpc: "2.0",
                    error: error ? {code: -1, message: error} : null,
                    result: result
                }) + "\n";
                socket.write(sendData);
            };

            handleMinerMethod(jsonData.method, jsonData.params, socket.remoteAddress, portData, sendReply, pushMessage);
        };

        var socketResponder = function(socket){
            socket.setKeepAlive(true);
            socket.setEncoding('utf8');

            var dataBuffer = '';

            var pushMessage = function(method, params){
                if(!socket.writable) return;
                var sendData = JSON.stringify({
                    jsonrpc: "2.0",
                    method: method,
                    params: params
                }) + "\n";
                socket.write(sendData);
            };

            socket.on('data', function(d){
                dataBuffer += d;
                if (Buffer.byteLength(dataBuffer, 'utf8') > 10240){ //10KB
                    dataBuffer = null;
                    log('warn', logSystem, 'Socket flooding detected and prevented from %s', [socket.remoteAddress]);
                    socket.destroy();
                    return;
                }
                if (dataBuffer.indexOf('\n') !== -1){
                    var messages = dataBuffer.split('\n');
                    var incomplete = dataBuffer.slice(-1) === '\n' ? '' : messages.pop();
                    for (var i = 0; i < messages.length; i++){
                        var message = messages[i];
                        if (message.trim() === '') continue;
                        var jsonData;
                        try{
                            jsonData = JSON.parse(message);
                        }
                        catch(e){
                            if (message.indexOf('GET /') === 0) {
                                if (message.indexOf('HTTP/1.1') !== -1) {
                                    socket.end('HTTP/1.1' + httpResponse);
                                    break;
                                }
                                else if (message.indexOf('HTTP/1.0') !== -1) {
                                    socket.end('HTTP/1.0' + httpResponse);
                                    break;
                                }
                            }

                            log('warn', logSystem, 'Malformed message from %s: %s', [socket.remoteAddress, message]);
                            socket.destroy();

                            break;
                        }
                        handleMessage(socket, jsonData, pushMessage);
                    }
                    dataBuffer = incomplete;
                }
            }).on('error', function(err){
                if (err.code !== 'ECONNRESET')
                    log('warn', logSystem, 'Socket error from %s %j', [socket.remoteAddress, err]);
            }).on('close', function(){
                pushMessage = function(){};
            });
        };

        if (portData.ssl) {
            if (!global.config.poolServer.sslCert) {
                log('error', logSystem, 'Could not start server listening on port %d (SSL): SSL certificate not configured', [portData.port]);
                cback(true);
            } else if (!global.config.poolServer.sslKey) {
                log('error', logSystem, 'Could not start server listening on port %d (SSL): SSL key not configured', [portData.port]);
                cback(true);
            } else if (!global.config.poolServer.sslCA) {
                log('error', logSystem, 'Could not start server listening on port %d (SSL): SSL certificate authority not configured', [portData.port]);
                cback(true);
            } else if (!fs.existsSync(global.config.poolServer.sslCert)) {
                log('error', logSystem, 'Could not start server listening on port %d (SSL): SSL certificate file not found (configuration error)', [portData.port]);
                cback(true);
            } else if (!fs.existsSync(global.config.poolServer.sslKey)) {
                log('error', logSystem, 'Could not start server listening on port %d (SSL): SSL key file not found (configuration error)', [portData.port]);
                cback(true);
            } else if (!fs.existsSync(global.config.poolServer.sslCA)) {
                log('error', logSystem, 'Could not start server listening on port %d (SSL): SSL certificate authority file not found (configuration error)', [portData.port]);
                cback(true);
            } else {
                var options = {
                    key: fs.readFileSync(global.config.poolServer.sslKey),
                    cert: fs.readFileSync(global.config.poolServer.sslCert),
                    ca: fs.readFileSync(global.config.poolServer.sslCA)
                };
                tls.createServer(options, socketResponder).listen(portData.port, function (error, result) {
                    if (error) {
                        log('error', logSystem, 'Could not start server listening on port %d (SSL), error: $j', [portData.port, error]);
                        cback(true);
                        return;
                    }

                    log('info', logSystem, 'Clear values for SSL port %d in redis database.', [portData.port]);
                    redisClient.del([global.config.coin + ':ports:'+portData.port]);
                    redisClient.hset([global.config.coin + ':ports:'+portData.port, 'port', portData.port ]);

                    log('info', logSystem, 'Started server listening on port %d (SSL)', [portData.port]);
                    cback();
                });
            }
        } 
        else {
            net.createServer(socketResponder).listen(portData.port, function (error, result) {
                if (error) {
                    log('error', logSystem, 'Could not start server listening on port %d, error: $j', [portData.port, error]);
                    cback(true);
                    return;
                }

                log('info', logSystem, 'Clear values for port %d in redis database.', [portData.port]);
                redisClient.del([global.config.coin + ':ports:'+portData.port]);
                redisClient.hset([global.config.coin + ':ports:'+portData.port, 'port', portData.port ]);

                log('info', logSystem, 'Started server listening on port %d', [portData.port]);
                cback();
            });
        }
    }, function(err){
        if (err)
            callback(false);
        else
            callback(true);
    });
}
