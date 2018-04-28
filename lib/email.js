var fs = require('fs');
var nodemailer = require('nodemailer');
var mailgun = require('mailgun.js');

var logSystem = 'email';

// Sends out an email
exports.sendEmail = function(email, subject, template, variables) {
    // Return error if no destination email address
    if (!email) {
        log('warn', logSystem, 'Unable to send e-mail: no destination email.');
    	return ;
    }

    // Check email system configuration
    if (!global.config.email) {
        log('error', logSystem, 'Email system not configured!');
    	return ;
    }
	
    // Do nothing if email system is disabled
    if (!global.config.email.enabled) return ;

    // Check if template is enabled
    var allow_template = true;
    if (global.config.email.disableTemplates && global.config.email.disableTemplates.length > 0) {
        for (var i = 0; i <= global.config.email.disableTemplates.length; i++) {
            if (global.config.email.disableTemplates[i] === template) {
                allow_template = false;
	        break;
            }
        }
    }
    if (!allow_template) return ;
    
    // Get email body (content)
    var body = getEmailTemplate(template);

    // Replace variables
    var replacement = getVariablesRegEx(variables);
    subject = replaceVariables(subject, replacement);
    body = replaceVariables(body, replacement);

    // Set message data
    var messageData = {
        from: global.config.email.fromAddress,
        to: email,
        subject: subject,
        text: body
    };
    
    // Backward compatibility
    if (!global.config.email.transport) {
        if (global.config.email.apiKey && global.config.email.apiDomain) {
            global.config.email.transport = "mailgun";
            global.config.email.mailgun = { "key": global.config.email.apiKey, "domain": global.config.email.apiDomain };
        } else {
            global.config.email.transport = "sendmail";
	    global.config.email.smtp = { "path:": "/usr/sbin/sendmail" }
	}
    }
    
    // Get email transport
    var transportMode = global.config.email.transport;
    var transportCfg = global.config.email[transportMode] ? global.config.email[transportMode] : {};
    
    if (transportMode === "mailgun") {
        var mg = mailgun.client({username: 'api', key: transportCfg.key});
        mg.messages.create(transportCfg.domain, messageData);
        log('info', logSystem, 'E-mail sent to %s: %s', [messageData.to, messageData.subject]);
    }
    
    else {
        transportCfg['transport'] = transportMode;
        var transporter = nodemailer.createTransport(transportCfg);
        transporter.sendMail(messageData, function(error){
            if(error){
                log('error', logSystem, 'Unable to send e-mail to %s: %s', [messageData.to, error.toString()]);
            } else {
                log('info', logSystem, 'E-mail sent to %s: %s', [email, subject]);
            }
        });	
    }
};

// Get regular expressions for variables
function getVariablesRegEx(variables) {
    if (!variables) variables = {};
    if (global.config.email.domain) variables['POOL_HOST'] = global.config.email.domain;
    if (global.config.email.variables) {
        for (var varName in global.config.email.variables) {
            variables[varName] = global.config.email.variables[varName];
	}
    }

    var result = [];
    if (variables) {
        for (var varName in variables) {
            result.push([new RegExp('%'+varName+'%', 'g'), variables[varName]]);
        }
    }
    return result;
}

// Replace variables in string
function replaceVariables(string, replacement) {
    if (!string) string = '';
    for (var i = 0; i < replacement.length; i++) {
      string = string.replace(replacement[i][0], replacement[i][1]);
    }
    string = string.replace(/  /, ' ');
    return string;
}

// Reads an email template file and returns it.
function getEmailTemplate(template_name) {
  var content = fs.readFileSync(global.config.email.templateDir + '/' + template_name, 'utf8');
  return content;
}

