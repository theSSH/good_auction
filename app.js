const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const helmet = require('helmet');
const hpp = require('hpp');
const cors = require('cors');
const compression = require('compression');
const bodyParser = require('body-parser');
const redis = require('redis');
const session = require('express-session');
const RedisStore = require('connect-redis')(session);

require('dotenv').config();
process.env.IS_DEV = process.env.NODE_ENV === 'development' ? '1' : ''; // process.env 는 string화 되기 때문에 false가 'false' 가 되어서 굳이 '' 로 지정한다.
process.env.IS_PC = (process.platform === "win32" || process.platform === "darwin") ? '1' : '';
process.env.PORT = process.env.PORT || '3000';
process.env.IS_PM2 = ('PM2_HOME' in process.env || 'PM2_JSON_PROCESSING' in process.env || 'PM2_CLI' in process.env) ? 'true' : '';
process.env.HOST = require('os').hostname();
process.env.ROOT = __dirname;
console.log(`=== NODE_ENV : ${process.env.NODE_ENV}, PORT : ${process.env.PORT}, LOCAL : http://localhost:${process.env.PORT} ===`);

const app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(compression());
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public')));

if (process.env.IS_DEV) {
  app.use(cors({origin: true, credentials:true}));
} else {
  // app.use(cors());
  app.use(cors({origin: true, credentials:true}));
}

app.use(cookieParser());
app.use(bodyParser.json({limit: "500mb"}));
app.use(bodyParser.urlencoded({limit: "500mb", extended: true, parameterLimit:50000}));

if (!process.env.IS_DEV) {
  app.use(helmet());
  app.use(hpp({checkQuery: false})); // checkQuery:true 인 경우 f_brandno[0]=38 을 파싱할 때 array 가 아닌 string으로 만든다(array로 된 원본을 req.queryPolluted 에 저장한다)
  app.use(logger('combined'));
} else {
  app.use(logger('dev'));
}

// session 설정
const redisClient = redis.createClient({host: process.env.REDIS_HOST, port: process.env.IS_DEV ? 16380 : 6379, db: 8});
app.use(session({
  store: new RedisStore({client: redisClient, ttl: 3600 * 48}),
  secret : 'Rs89Irqw67YEA55cLMasdfgi0t6oyr8568e6KtD',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: false,
  },
}));

app.use('/', require('./routes'));


// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
