const qs = require('querystring');
const axios = require('axios-https-proxy-fix');
const {db, sdb, second, stat} = require('../db/mongo');
const utils = require('./index');

let slack = module.exports = {
  slackUri: {
    'general': 'TBX1ACR3N/BC5MGLA6R/4sJZL6GqS22thwLFalySeXKt',
    // 'general': 'TBX1ACR3N/BG6EQKAH1/4r0agca3bSfHCxXhzVgRUwOT', // FINGERPRINT_BOT
    'api': 'TBX1ACR3N/BCBLK9FM4/JeiSs4NoYrkXOjKlsyaknO0D', // api ?
    'external_order_alarm': 'TBX1ACR3N/BCQ9T8U78/whRFRmABMxtbSwjey5FfixVj',
    'project_external_api': 'TBX1ACR3N/BKQLU0A5Q/5b7qJEokAxTjGM5ZS54gaDXP',
    'project-datahub': 'TBX1ACR3N/BNS7QREJK/SbP9AXSPnCe9YklyoGHiQryt',
    'unknown': 'TBX1ACR3N/BCBLK9FM4/JeiSs4NoYrkXOjKlsyaknO0D',
  },
  async sendSlack(uri, json){
    /**
     * json sample : {"text": "[지문봇] 퇴근시 꼭 지문 찍어주세요!!"}
     * return : "ok"
     */
    return (await axios.post("https://hooks.slack.com/services/"+(this.slackUri[uri] || uri), json, {headers: {'Content-Type': 'application/json'}})).data;
  },

  botToken: 'xoxb-405044433124-1005475838768-OUiafJLSF83k5NU3nuAS4sfn',
  async api(method, params){
    /**
     * https://api.slack.com/methods/chat.postMessage/test
     * https://slack.com/api/chat.postMessage?token=xoxb-405044433124-1005475838768-OUiafJLSF83k5NU3nuAS4sfn&channel=testchan&text=%40here%20s&link_names=true&pretty=1
     */
    let r;
    let data = {...params, token:slack.botToken};
    try {
      r = await axios.post(`https://slack.com/api/${method}`, qs.stringify(data));
      await second.slack.raw_api.insertOne({method, data, res:r.data, headers:r.headers});
    } catch (e) {
      await second.slack.raw_api.insertOne({method, data, error:e.message, status:e.status});
      throw e;
    }
    // if (!r.data.ok) {
    //   throw new Error(r.data.error);
    // }
    return r.data;
  },
  async chat(channel, text) {
    /**
     * text = '메시지'
     * text = {text:'메시지', icon_url:'', blocks:'[{"type": "section", "text": {"type": "plain_text", "text": "Hello world"}}]', username:'Bot'}
     */
    let _t = +new Date, _dt = utils.kstDT(_t);
    if (typeof(text) === 'string') text = {text};
    text.text = await slack.replaceUserMention(text.text);
    let r = await slack.api('chat.postMessage', {channel, link_names:true, ...text});
    await second.slack.chat.insertOne({...r, _t, _dt});
    return r.ts;
  },
  async thread(ts, text) {
    /**
     * text = '메시지'
     */
    let _t = +new Date, _dt = utils.kstDT(_t);
    let c = await second.slack.chat.findOne({ts});
    if (c) {
      if (typeof (text) === 'string') text = {text};
      text.text = await slack.replaceUserMention(text.text);
      let r = await slack.api('chat.postMessage', {channel:c.channel, thread_ts:ts, link_names: true, ...text});
      await second.slack.chat.insertOne({...r, _t, _dt});
      return r.ts;
    } else {
      // return {ok: false, error: 'ts not found'};
      return false;
    }
  },
  async updateChat(ts, text) {
    let _t = +new Date, _dt = utils.kstDT(_t);
    let c = await second.slack.chat.findOne({ts});
    if (c) {
      if (typeof(text) === 'string') text = {text};
      text.text = await slack.replaceUserMention(text.text);
      let r = await slack.api('chat.update', {channel:c.channel, ts, link_names:true, ...text});
      if (r.ok) await second.slack.chat.updateOne({_id:c._id}, {$push:{_update:{...text, _t, _dt}}});
      return r;
    } else {
      return {ok: false, error: 'ts not found'};
    }
  },
  async deleteChat(ts) {
    let _t = +new Date, _dt = utils.kstDT(_t);
    // {"ok": true, "channel": "CV6KHBSRG", "ts": "1584446541.000900"}
    let c = await second.slack.chat.findOne({ts});
    if (c) {
      let r = await slack.api('chat.delete', {channel:c.channel, ts});
      if (r.ok || r.error === 'message_not_found') await second.slack.chat.updateOne({_id:c._id}, {$set:{deleted:true, _del_t:_t, _del_dt:_dt}});
      return r;
    } else {
      return {ok: false, error: 'ts not found'};
    }
  },
  async replaceUserMention(text) {
    let u = await second.slack.user.find({deleted:false}, {projection:{real_name:1, id:1}}).toArray();
    u.forEach(e=>{
      text = text.replace(`@${e.real_name}`, `<@${e.id}>`);
    });
    return text;
  },
  async channelList() {
    return (await slack.api('channels.list', {})).channels;
  },
  async userList() {
    /**
     *  [{
            "id": "USLACKBOT",
            "name": "slackbot",
            ...
     */
    return (await slack.api('users.list', {})).members;
  },
  async refresh() {
    let chs = await slack.channelList();
    let users = await slack.userList();
    await second.slack.channel.deleteMany({});
    chs.length && await second.slack.channel.insertMany(chs);
    await second.slack.user.deleteMany({});
    users.length && await second.slack.user.insertMany(users);
  },
};

(async ()=>{
  await SECOND_SLACK;
  await slack.refresh();
})();
