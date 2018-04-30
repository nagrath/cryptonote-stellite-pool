var fs = require('fs');

if(global.config){
    return;
}

var configFile = (function(){
    for (var i = 0; i < process.argv.length; i++){
        if (process.argv[i].indexOf('-config=') === 0)
            return process.argv[i].split('=')[1];
        else if (process.argv[i].indexOf('-config') === 0)
            return process.argv[i].replace(/^-config/, '').replace(/\s$/,'');
    }
    return 'config.json';
})();


try {
    global.config = JSON.parse(fs.readFileSync(configFile));
    //Enable db to be selected
    if(!global.config.redis.db){
		global.config.redis.db = 0;	 
    }

    if(!global.config.poolServer.shareTrust){
        global.config.poolServer.shareTrust = {enabled:false};
    }

    if(!global.config.poolServer.banning){
        global.config.poolServer.banning = {enabled:false};
    }    

    if (!global.config.poolServer.paymentId) {
        global.config.poolServer.paymentId = {
            enabled:true,
            addressSeparator :'.'
        };
    }else if (!global.config.poolServer.paymentId.addressSeparator) {
        global.config.poolServer.paymentId.addressSeparator = ".";
    }

    if (!global.config.poolServer.fixedDiff) {
        global.config.poolServer.fixedDiff = {
            enabled:true,
            addressSeparator :'+'
        };
    }else if (!global.config.poolServer.fixedDiff.addressSeparator) {
         global.config.poolServer.fixedDiff.addressSeparator = "+";
    }

    // Enable to be bind to a certain ip or all by default
    if(!global.config.api.bindIp){
        global.config.api.bindIp = "0.0.0.0";
    }

    // Check telegram configuration
    if (!global.config.telegram) {
        global.config.telegram = {enabled:false};
    }
    
    if(!global.config.redis.cleanupInterval || global.config.redis.cleanupInterval < 1 ){
        global.config.redis.cleanupInterval = 15;    
    }

}catch(e){
    console.error('Failed to read config file ' + configFile + '\n\n' + e);
    return;
}

var donationAddresses = {
    devDonation: {
	   BTC: '3Kp1tkDfEshZDPfizTfVVJB86VmXmUMRqA',
        XTL: 'Se2ef2vWfM5je9M9p9RXnb3YG1Bxm7eLJb4np1TdJmbTfo5VAo43g2EFikEG7wenV2BihjyWmoDL1efXafFfDJoE2GcxJtvH7',
    }
};

global.donations = {};

for(var configOption in donationAddresses) {
    var percent = global.config.blockUnlocker[configOption];
    var wallet = donationAddresses[configOption][global.config.symbol];
    if(percent && wallet) {
        global.donations[wallet] = percent;
    }
}

global.version = "v1.2.10.2-0.1.4";
