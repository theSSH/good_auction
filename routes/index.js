const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const axios = require('axios-https-proxy-fix');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const iconv = require('iconv-lite');
const utils = require('../utils');
const R = utils.checkRole;
const {HUB, HUB_SECONDARY, SECOND, STAT} = require('../db/mongo');

router.use(async (req, res, next) => {
  // db wait
  await HUB;
  await HUB_SECONDARY;
  await SECOND;
  await STAT;
  next();
});

router.use('/shopping', require('./shopping'));

router.get('/', async (req, res) => {
  res.send('hi');
});

router.get('/ping', async (req, res) => {
  res.json({ok:1, msg:'pong'});
});

router.get('/proxy/:url', async (req, res) => {
  let url = req.params.url;
  if (!url.startsWith('http')) url = 'http://' + url;
  let response = await axios.get(url, {responseType: 'arraybuffer', responseEncoding: 'binary'});
  let text = iconv.decode(response.data, "euc-kr");
  res.send(text);
});

module.exports = router;
