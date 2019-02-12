import * as path from 'path';
import express from 'express';
import bodyParser from 'body-parser';
import * as dotenv from 'dotenv-safe';
dotenv.config();
const PORT = process.env.PORT || 3000;

// ===== My Custom Modules =====
import { initDB } from './db';
import { parseZulipServerRequest } from './zulip_coms/cliParser';
import {
  messageTypeEnum,
  zulipMsgSender,
  sendGenericMessage,
  IMsgSenderArgs
} from './zulip_coms/msgSender';
import { parseStrAsBool, validatePayload } from './utils/';

// ==== TypeScript Interfaces =====
import { directives, ICliAction, subCommands } from './zulip_coms/interface';
import { ISqlOk, ISqlError } from './db/db.interface';

/////////////////
/// Database
/////////////////
const db = (() => {
  const isProd = process.env.NODE_ENV === 'production';
  const DB_FILE = isProd ? 'prod.db' : 'dev.db';
  const fileMustExist = isProd;
  const DB_PATH = path.join(__dirname, '../', 'data/', DB_FILE);

  return initDB(DB_PATH, fileMustExist);
})();

/////////////////
/// Server
/////////////////
const app = express();

// Handle messages received from Zulip outgoing webhooks
app.post('/webhooks/zulip', bodyParser.json(), (req, res) => {
  res.json({});

  const senderEmail = req.body.message.sender_email;
  let sqlResult: ISqlOk | ISqlError;
  let messageType: messageTypeEnum;

  ////////////////////////////////////////////////////
  // CHECK IF VALID USER / IF THEY ARE SIGNED UP
  /////////////////////////////////////////////////////
  // TODO: move to middleware eventually?
  const userExists = db.user.find(senderEmail);
  if (!userExists) {
    // TODO: check if the first word in message is signup!
    const wantsToSignUp = req.body.data.match(/signup/gi);

    if (wantsToSignUp) {
      sqlResult = db.user.add({
        email: senderEmail,
        full_name: req.body.message.sender_full_name
      });

      zulipMsgSender(senderEmail, {
        status: sqlResult.status,
        messageType: messageTypeEnum.SIGNUP
      });
    } else {
      zulipMsgSender(senderEmail, {
        status: 'OK',
        messageType: messageTypeEnum.PROMPT_SIGNUP
      });
    }

    return;
  }

  ////////////////////////////////////////////////////
  // Parse ZULIP Message
  /////////////////////////////////////////////////////
  // TODO: modify parseZulipServerRequest --> make it a middleware
  let cliAction: ICliAction;
  try {
    cliAction = parseZulipServerRequest(req.body);
  } catch (e) {
    // TODO: update this to use zulipMsgSender
    sendGenericMessage(senderEmail, e.message);
    console.log(e.message);
    return;
  }

  ////////////////////////////////////////////////////
  // Dispatch Action off Zulip CMD
  /////////////////////////////////////////////////////
  console.log('==== Received Valid cliAction =====');
  console.log(cliAction);

  if (
    cliAction.directive === directives.CHANGE ||
    cliAction.directive === directives.UPDATE
  ) {
    /////////////////////////////////////
    // CHANGE/UPDATE
    /////////////////////////////////////
    switch (cliAction.subCommand) {
      case subCommands.DAYS:
      case subCommands.DATES:
        sqlResult = db.user.updateCoffeeDays(senderEmail, cliAction.payload);
        messageType = messageTypeEnum.UPDATE_DAYS;
        break;

      case subCommands.SKIP:
        messageType = messageTypeEnum.UPDATE_SKIP;
        try {
          validatePayload(cliAction.payload);
          const parsedBooleanVal = parseStrAsBool(cliAction.payload[0]);

          sqlResult = db.user.updateSkipNextMatch(
            senderEmail,
            parsedBooleanVal
          );
        } catch (e) {
          sendGenericMessage(senderEmail, e);
          return;
        }
        break;

      case subCommands.WARNINGS:
        messageType = messageTypeEnum.UPDATE_WARNINGS;
        try {
          validatePayload(cliAction.payload);
          const parsedBooleanVal = parseStrAsBool(cliAction.payload[0]);

          sqlResult = db.user.updateWarningException(
            senderEmail,
            parsedBooleanVal
          );
        } catch (e) {
          sendGenericMessage(senderEmail, e);
          return;
        }
        break;

      default:
        console.log(`No handler written for ${cliAction.subCommand}`);
        break;
    }
  } else if (cliAction.directive === directives.STATUS) {
    /////////////////////////////////////
    // STATUS
    /////////////////////////////////////
    switch (cliAction.subCommand) {
      case subCommands.DATES:
      case subCommands.DAYS:
        sqlResult = db.user.getCoffeeDays(senderEmail);
        messageType = messageTypeEnum.STATUS_DAYS;
        break;

      case subCommands.WARNINGS:
        sqlResult = db.user.getWarningStatus(senderEmail);
        messageType = messageTypeEnum.STATUS_WARNINGS;
        break;

      case subCommands.SKIP:
        sqlResult = db.user.getNextStatus(senderEmail);
        messageType = messageTypeEnum.STATUS_SKIP;
        break;

      default:
        messageType = messageTypeEnum.HELP_STATUS;
        break;
    }
  } else if (cliAction.directive === directives.ADMIN) {
    // TODO: check if admin, #TEMP: only my email
    if (senderEmail !== 'alancodes@gmail.com') {
      sendGenericMessage(
        senderEmail,
        `Sorry admin features are reserved for the current maintainer only.`
      );
      return;
    }
    // TODO:
    // active users
    // matches for today
    // totally users who used coffee chat bot:
    // total matches, given a day? month? etc?
  } else {
    /////////////////////////////////////
    // HELP subcommand switch block
    /////////////////////////////////////
    // TODO: send back message for Help, or additional commands:
  }

  // ====== Zulip Message ==========
  const zulipMsgOpts: IMsgSenderArgs = {
    messageType,
    status: sqlResult.status,
    payload: sqlResult.payload,
    message: sqlResult.message,
    cliAction
  };
  zulipMsgSender(senderEmail, { ...zulipMsgOpts, cliAction });
});

app.post('/cron/run', (request, response) => {
  // logger.info('Running the matcher and sending out matches');
  if (request.headers.secret === process.env.RUN_SECRET) {
    console.log('Run the main function here');
  }
  response.status(200).json({ status: 'ok' });
});

// app.post('/cron/run/warnings', (request, response) => {
//   // logger.info('Sending warning messages about tomorrow matches');
//   if (request.headers.secret === process.env.RUN_SECRET) {
//     console.log('run warning messages here');
//     // runWarningMessages();
//   }
//   response.status(200).json({ status: 'ok' });
// });

// listen for requests :)
app.listen(PORT, () => {
  console.log(`🌍 is listening on port: ${PORT}`);
});
