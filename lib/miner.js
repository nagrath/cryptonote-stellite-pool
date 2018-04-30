var utils = require('./utils.js');


var addressBase58Prefix = utils.address_decode(new Buffer(global.config.poolServer.poolAddress));
var integratedAddressBase58Prefix = addressBase58Prefix + 1; // Integrated address prefixes are address prefix + 1


var Miner = function (pushMessage,sendReply){
    
    this.id;
    this.login;
    this.pass;
    this.ip;
    this.port;
    this.workerName;
    this.email;
    this.pushMessage;
    this.noRetarget = false;
    this.difficulty = 0;
    this.validJobs = [];
    
    this.sendReply = sendReply;
    this.pushMessage = pushMessage;

    this.validJobs = [];
    // Vardiff related variables
    this.shareTimeRing = utils.ringBuffer(16);
    this.lastShareTime = Date.now() / 1000 | 0;

    if (global.config.poolServer.shareTrust.enabled) {
        this.trust = {
            threshold: global.config.poolServer.shareTrust.threshold,
            probability: 1,
            penalty: 0
        };
    }
}
Miner.prototype = {
    setParams:function(params){

        var login = params.login;
        if (!login){
            this.sendReply('Missing login');
            return false;
        }

        var pass = params.pass;
        var email = '';
        var workerName = '';
        
        if (params.rigid) {
            workerName = utils.cleanupSpecialChars(params.rigid.trim());
        } else if (pass) {
            workerName = pass.trim();
            if (pass.indexOf(':') >= 0 && pass.indexOf('@') >= 0) {
                passDelimiterPos = pass.lastIndexOf(':');
                workerName = pass.substr(0, passDelimiterPos).trim();
                email = pass.substr(passDelimiterPos + 1).trim();
            }
            workerName = utils.cleanupSpecialChars(workerName);
            workerName = workerName.replace(/:/g, '');
            workerName = workerName.replace(/\+/g, '');
            workerName = workerName.replace(/\s/g, '');
            if (workerName.toLowerCase() === 'x') {
                workerName = '';
            }
        }

        if (!workerName || workerName === '') {
            workerName = 'undefined';
        }
        
        var difficulty = 0;
        var noRetarget = false;
        
        if(!global.config.poolServer.fixedDiff.enabled) {
            var fixedDiffCharPos = login.lastIndexOf(global.config.poolServer.fixedDiff.addressSeparator);    
            if (fixedDiffCharPos !== -1 && (login.length - fixedDiffCharPos < 32)){//Integration ID valid?
                difficulty = parseInt(login.substr(fixedDiffCharPos + 1));
                login = login.substr(0, fixedDiffCharPos);
                if (difficulty < global.config.poolServer.varDiff.minDiff) {
                    difficulty = global.config.poolServer.varDiff.minDiff;
                }else{
                    noRetarget = true;   
                }
            }
        }
        
        var addr = login.split(global.config.poolServer.paymentId.addressSeparator);
        var address = addr[0];

        var addressPrefix = utils.cnUtil.address_decode(new Buffer(address));
        if (addressBase58Prefix !== addressPrefix && integratedAddressBase58Prefix !== addressPrefix){
            log('warn', logSystem, 'Invalid address used for login: %s', [address]);
            this.sendReply('Invalid address used for login');
            return false;
        }

        this.id =  utils.uid();
        // id, login, pass, ip, port, workerName, email, startingDiff, noRetarget, 
        
        this.login = login;
        this.pass = pass;
        this.workerName = workerName;
        this.email = email;
        
        this.noRetarget = noRetarget;
        this.difficulty = difficulty;

        return true;
        
    },
    retarget: function(now){

        var options = global.config.poolServer.varDiff;

        var sinceLast = now - this.lastShareTime;
        var decreaser = sinceLast > VarDiff.tMax;

        var avg = this.shareTimeRing.avg(decreaser ? sinceLast : null);
        var newDiff;

        var direction;

        if (avg > VarDiff.tMax && this.difficulty > options.minDiff){
            newDiff = options.targetTime / avg * this.difficulty;
            newDiff = newDiff > options.minDiff ? newDiff : options.minDiff;
            direction = -1;
        }
        else if (avg < VarDiff.tMin && this.difficulty < options.maxDiff){
            newDiff = options.targetTime / avg * this.difficulty;
            newDiff = newDiff < options.maxDiff ? newDiff : options.maxDiff;
            direction = 1;
        }
        else{
            return;
        }

        if (Math.abs(newDiff - this.difficulty) / this.difficulty * 100 > options.maxJump){
            var change = options.maxJump / 100 * this.difficulty * direction;
            newDiff = this.difficulty + change;
        }

        this.setNewDiff(newDiff);
        this.shareTimeRing.clear();
        if (decreaser) this.lastShareTime = now;
    },
    setNewDiff: function(newDiff){
        newDiff = Math.round(newDiff);
        if (this.difficulty === newDiff) return;
        log('info', logSystem, 'Retargetting difficulty %d to %d for %s', [this.difficulty, newDiff, this.login]);
        this.pendingDifficulty = newDiff;
        this.pushMessage('job', this.getJob());
    },
    heartbeat: function(){
        this.lastBeat = Date.now();
    },
    
    getJob: function(currentBlockTemplate,difficultyBuffer){
        if (this.lastBlockHeight === currentBlockTemplate.height && !this.pendingDifficulty) {
            return {
                blob: '',
                job_id: '',
                target: ''
            };
        }

        var blob = currentBlockTemplate.nextBlob();
        this.lastBlockHeight = currentBlockTemplate.height;

        var target = (function(self,diff1){
            if (self.pendingDifficulty){
                self.lastDifficulty = self.difficulty;
                self.difficulty = self.pendingDifficulty;
                self.pendingDifficulty = null;
            }

            var padded = new Buffer(32);
            padded.fill(0);

            var diffBuff = diff1.div(self.difficulty).toBuffer();
            diffBuff.copy(padded, 32 - diffBuff.length);

            var buff = padded.slice(0, 4);
            var buffArray = buff.toByteArray().reverse();
            var buffReversed = new Buffer(buffArray);
            self.target = buffReversed.readUInt32BE(0);
            var hex = buffReversed.toString('hex');
            return hex;
        })(this,difficultyBuffer)

        var newJob = {
            id: utils.uid(),
            extraNonce: currentBlockTemplate.extraNonce,
            height: currentBlockTemplate.height,
            difficulty: this.difficulty,
            diffHex: this.diffHex,
            submissions: []
        };

        this.validJobs.push(newJob);

        if (this.validJobs.length > 4)
            this.validJobs.shift();

        return {
            blob: blob,
            job_id: newJob.id,
            target: target,
            id: this.id,
            algo: "cn/xtl"
        };
    },
    checkBan: function(validShare,perIPStats){
        if (!global.config.poolServer.banning.enabled) return;
    
        // Init global per-ip shares stats
        if (!perIPStats[this.ip]){
            perIPStats[this.ip] = { validShares: 0, invalidShares: 0 };
        }
    
        var stats = perIPStats[this.ip];
        validShare ? stats.validShares++ : stats.invalidShares++;
    
        if (stats.validShares + stats.invalidShares >= global.config.poolServer.banning.checkThreshold){
            if (stats.invalidShares / stats.validShares >= global.config.poolServer.banning.invalidPercent / 100){
                validShare ? this.validShares++ : this.invalidShares++;
                log('warn', logSystem, 'Banned %s@%s', [this.login, this.ip]);
                bannedIPs[this.ip] = Date.now();
                delete connectedMiners[this.id];
                process.send({type: 'banIP', ip: this.ip});
                removeConnectedWorker(this, 'banned');
            }
            else{
                stats.invalidShares = 0;
                stats.validShares = 0;
            }
        }
    }
};

module.exports = Miner;
