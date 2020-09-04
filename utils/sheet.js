/**
 * https://developers.google.com/sheets/api/quickstart/nodejs 에서 enable을 한다.
 *
 * 최초 시작시 콘솔에 url 이 나오고 별도로 인증과정을 거친 뒤 사용 가능하다.
 * 사용자가 삭제되었을 때 어떻게 될지는 미정
 *
 * 아래와 같이 사용한다.
   const sheet = require('../utils/sheet');
   let url = await sheet.authorize();

   let arr = await sheet.read('1jqyww6mj159ODSV-wC_4X7Q_mPeIcXbSuNt7X3jSuq4', '시트1!A1:B1'); // i18n
   console.log(arr);
 */
const { promisify } = require('util');
const fs = require('fs');
const read = promisify(fs.readFile), write = promisify(fs.writeFile);
const {google} = require('googleapis');
const {db, sdb, second, stat} = require('../db/mongo');
const utils = require('./index');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = process.env.ROOT + '/utils/token.json';

let client;
module.exports = {
  /**
   * Create an OAuth2 client with the given credentials, and then execute the
   * given callback function.
   * @param {Object} credentials The authorization client credentials.
   * @param {function} callback The callback to call with the authorized client.
   */
  async authorize(code) {
    // let credentials = JSON.parse(await read(process.env.ROOT + '/utils/cre.json'));
    // await db.google.credentials.insertOne({...credentials, ...utils.getTimestamp()});
    let credentials = await db.google.credentials.findOne();
    if (!credentials) return false;
    const {client_secret, client_id, redirect_uris} = credentials.installed;
    const oAuth2Client = client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

    // Check if we have previously stored a token.
    try {
      if (code) {
        await this.setCode(code);
      } else {
        // let token = JSON.parse(await read(TOKEN_PATH));
        // await db.google.tokens.insertOne({...token, ...utils.getTimestamp()});
        let token = (await db.google.tokens.find().sort({_t:-1}).limit(1).toArray())[0];
        if (!token) return this.getNewToken();
        oAuth2Client.setCredentials(token);
      }
    } catch (e) {
      return this.getNewToken();
    }
  },

  /**
   * Get and store new token after prompting for user authorization, and then
   * execute the given callback with the authorized OAuth2 client.
   * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
   * @param {getEventsCallback} callback The callback for the authorized client.
   */
  getNewToken() {
    const authUrl = client.generateAuthUrl({access_type: 'offline', scope: SCOPES});
    console.log('Authorize this app by visiting this url:', authUrl);
    return authUrl;
  },

  async setCode(code) {
    await new Promise((resolve, reject) => {
      client.getToken(code, (err, token) => {
        if (err) reject(err);
        client.setCredentials(token);
        // Store the token to disk for later program executions
        // write(TOKEN_PATH, JSON.stringify(token)).then(e=>resolve(e));
        db.google.tokens.insertOne({...token, ...utils.getTimestamp()}).then(e=>resolve(e));
      });
    });
  },

  async get(spreadsheetId, range) {
    /**
     * let arr = await sheet.get('1jqyww6mj159ODSV-wC_4X7Q_mPeIcXbSuNt7X3jSuq4', '시트1!A1:B1');
     */
    const sheets = google.sheets({version: 'v4', auth: client});
    let res = await sheets.spreadsheets.values.get({spreadsheetId, range});
    return res.data.values;
  },

  async append(spreadsheetId, range, values) {
    /**
     * await sheet.append('1jqyww6mj159ODSV-wC_4X7Q_mPeIcXbSuNt7X3jSuq4', '시트1!A:B', [['c', 'd']]);
     */
    const sheets = google.sheets({version: 'v4', auth: client});
    let res = await sheets.spreadsheets.values.append({spreadsheetId, range, valueInputOption: 'USER_ENTERED', resource: {majorDimension: 'ROWS', values}});
    return res.status;
  },

  async update(spreadsheetId, range, values) {
    /**
     * await sheet.update('1jqyww6mj159ODSV-wC_4X7Q_mPeIcXbSuNt7X3jSuq4', '시트1!A2:B2', [['c', 'd']]);
     */
    const sheets = google.sheets({version: 'v4', auth: client});
    let res = await sheets.spreadsheets.values.update({spreadsheetId, range, valueInputOption: 'USER_ENTERED', resource: {majorDimension: 'ROWS', values}});
    return res.status;
  },

  num2alpha(n, abs){
    let i = n + 1, alpha = [];
    while (i) {
      let mod = (i - 1) % 26;
      alpha.unshift(String.fromCharCode(65+mod));
      i = Math.floor((i - 1)/26);
    }
    return (abs ? '$' : '') + alpha.join('');
  },
  alpha2num(alpha){
    return alpha.split('').reverse().map((e,i)=>(e.charCodeAt(0)-64) * Math.pow(26,i)).reduce((a,b)=>a+b) - 1;
  },
  cell(...args) {
    if (args.length === 0) return '';
    if (typeof args[0] === 'number') {
      if (args.length === 1 || args.length === 2 && typeof args[1] === 'object') { // A or $A
        let {absRowA = false, absColA = false, absRowB = false, absColB = false} = args[1] || {};
        return this.num2alpha(args[0], absColA);
      } else if (args.length === 2) { // A1
        return this.num2alpha(args[1]) + (args[0] + 1);
      } else if (args.length === 3 && typeof args[2] === 'object') { // A$1
        let {absRowA = false, absColA = false, absRowB = false, absColB = false} = args[2];
        return this.num2alpha(args[1], absColA) + (absRowA ? '$' : '') + (args[0] + 1);
      } else if (args.length === 4) { // A1:B2
        return this.num2alpha(args[1]) + (args[0] + 1) + ':' + this.num2alpha(args[3]) + (args[2] + 1);
      } else if (args.length === 5) { // A$1:B$2
        let {absRowA = false, absColA = false, absRowB = false, absColB = false} = args[2];
        return this.num2alpha(args[1], absColA) + (absRowA ? '$' : '') + (args[0] + 1) + ':' + this.num2alpha(args[3], absColB) + (absRowB ? '$' : '') + (args[2] + 1);
      }
    } else if (typeof args[0] === 'string') {
      let [st, ed] = args[0].replace(/\$/g, '').split(':');
      let [all, col, row] = st.match(/([a-zA-Z]+)(\d*)/);
      let pos = [row - 1, this.alpha2num(col)];
      if (ed) {
        let [all, col, row] = ed.match(/([a-zA-Z]+)(\d*)/);
        pos = [...pos, row - 1, this.alpha2num(col)];
      }
      return pos;
    }
  }
};
