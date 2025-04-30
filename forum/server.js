const express = require('express')
const app = express()
const { MongoClient,ObjectId } = require('mongodb')
const methodOverride = require('method-override')
const bcrypt = require('bcrypt')

const { createServer } = require('http')
const { Server } = require('socket.io')
const server = createServer(app)
const io = new Server(server) 

require('dotenv').config()

app.use(methodOverride('_method'))
app.use(express.static(__dirname+'/public'))
app.set('view engine', 'ejs')
app.use(express.json())
app.use(express.urlencoded({extended:true}))


const session = require('express-session')
const passport = require('passport')
const LocalStrategy = require('passport-local')
const MongoStore = require('connect-mongo')

app.use(passport.initialize())
app.use(session({
  secret: '암호화에 쓸 비번',
  resave : false,
  saveUninitialized : false,
  cookie : {maxAge : 60 * 60 * 1000},
  store : MongoStore.create({
    mongoUrl : process.env.DB_URL,
    dbName : 'forum'
  })
}))

app.use(passport.session())


const { S3Client } = require('@aws-sdk/client-s3')
const multer = require('multer')
const multerS3 = require('multer-s3')
const connectDB = require('./database')
const s3 = new S3Client({
  region : 'ap-northeast-2',
  credentials : {
      accessKeyId : process.env.S3_KEY,
      secretAccessKey : process.env.S3_SECRET,
  }
})

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: 'lmw6996',
    key: function (요청, file, cb) {
      cb(null, Date.now().toString()) //업로드시 파일명 변경가능
    }
  })
})

let conDB = require('./database.js')

let db;
let changeStream
conDB.then((client)=>{
  console.log('DB연결성공')
  db = client.db('forum');
  const 조건 = [
    { $match: { operationType: 'insert' } }
  ]
  changeStream = db.collection('post').watch(조건)

  server.listen(process.env.PORT, () => {
    console.log('http://localhost:8080 에서 서버 실행중')
})
}).catch((err)=>{
  console.log(err)
})


app.get('/', (요청, 응답) => {
  응답.sendFile(__dirname + '/index.html')
}) 

app.get('/news', (요청, 응답) => {
  응답.send('오늘 비옴')
}) 

app.get('/list', async(요청, 응답) => {
  let result = await db.collection('post').find().toArray()
  응답.render('list.ejs',{글목록:result})
}) 

app.get('/write', (요청, 응답) => {
  응답.render('write.ejs')
}) 

app.post('/add', upload.single('img1'), async (요청, 응답) => {

  try{
    if(요청.body.title==''){
      응답.send('제목입력안함')
    }else{
    await db.collection('post').insertOne(
      {title : 요청.body.title, 
      content : 요청.body.content,
      img : 요청.file ? 요청.file.location : '',
      user : 요청.user._id,
      username : 요청.user.username
    })
    응답.redirect('/list')
    }
  }catch(e){
    console.log(e)
    응답.status(500).send('서버에러남')
  }
}) 

app.get('/detail/:id',async(요청,응답)=>{
  try{
    let result2 = await db.collection('comment').find({parentId : new ObjectId(요청.params.id) }).toArray()
    let result = await db.collection('post').findOne({_id : new ObjectId(요청.params.id)})
    if (result == null){
      응답.status(404).send('이상한 url 입력함')
    }
    응답.render('detail.ejs',{result:result, result2:result2})

  } catch(e){
    console.log(e)
    응답.status(404).send('이상한 url 입력함')
  }
})

app.get('/edit/:id',async (요청, 응답) => {
  let result = await db.collection('post').findOne({_id : new ObjectId(요청.params.id)})
  응답.render('edit.ejs',{result:result})
})

app.put('/edit',async (요청, 응답) => {
  await db.collection('post').updateOne({_id : new ObjectId(요청.body.id)},{$set : {title : 요청.body.title, content : 요청.body.content}})
  응답.redirect('/list')
})

app.delete('/delete', async(요청, 응답) => {
  await db.collection('post').deleteOne({
    _id : new ObjectId(요청.query.docid),
    user : new ObjectId(요청.user._id)
  })
  응답.send('삭제완료')
})

app.get('/list/:id', async(요청, 응답) => {
  let result = await db.collection('post').find().skip((요청.params.id - 1)*5).limit(5).toArray()
  응답.render('list.ejs',{글목록:result})
}) 

app.get('/list/next/:id', async (요청, 응답) => {
  let result = await db.collection('post').find({_id : {$gt : new ObjectId(요청.params.id) }}).limit(5).toArray()
  응답.render('list.ejs', { 글목록 : result })
}) 


passport.use(new LocalStrategy(async (입력한아이디, 입력한비번, cb) => {
  let result = await db.collection('user').findOne({ username : 입력한아이디})
  if (!result) {
    return cb(null, false, { message: '아이디 DB에 없음' })
  }
  if (await bcrypt.compare(입력한비번, result.password)) {
    return cb(null, result)
  } else {
    return cb(null, false, { message: '비번불일치' });
  }
}))

passport.serializeUser((user, done) => {
  process.nextTick(() => {
    done(null, { id: user._id, username: user.username })
  })
})

passport.deserializeUser(async (user, done) => {
  let result = await db.collection('user').findOne({_id : new ObjectId(user.id)}) 
  delete result.password
  process.nextTick(() => {
    done(null, result)
  })
})

app.get('/login', async (요청, 응답) => {
  응답.render('login.ejs')
}) 

app.post('/login', async (요청, 응답, next) => {
  passport.authenticate('local', (error, user, info)=>{
    if (error) return 응답.status(500).json(error)
    if (!user) return 응답.status(401).json(info.message)
    요청.logIn(user, (err)=>{
      if (err) return next(err)
      응답.redirect('/')
    })
  })(요청, 응답, next)
}) 

app.get('/register', (요청, 응답) => {
  응답.render('register.ejs')
})

app.post('/register', async (요청, 응답) => {

  let 해시 = await bcrypt.hash(요청.body.password, 10)
  await db.collection('user').insertOne({
    username : 요청.body.username,
    password : 해시
  })
  응답.redirect('/')
})

app.use('/shop', require('./routes/shop.js'))

app.get('/search', async (요청,응답) => {
  let 검색조건 = [
    {$search : {
      index : 'title_index',
      text : { query : 요청.query.val, path : 'title' }
    }}
  ]

  let result = await db.collection('post').aggregate(검색조건).toArray()
  응답.render('search.ejs',{글목록:result})
})

app.post('/comment', async (요청, 응답)=>{
  await db.collection('comment').insertOne({
    content : 요청.body.content,
    writerId : new ObjectId(요청.user.id),
    writer : 요청.user.username,
    parentId : new ObjectId(요청.body.parentId)
  })

  응답.redirect('back')
}) 

app.get('/chat/request', async (요청, 응답) => {
  await db.collection('chatroom').insertOne({
    member : [요청.user._id, new ObjectId(요청.query.writerId)],
    date : new Date()
  })
  응답.redirect('/chat/list')
})

app.get('/chat/list', async (요청, 응답) => {
   let result = await db.collection('chatroom').find({
    member : 요청.user._id
  }).toArray()
  응답.render('chatList.ejs',{result : result})
})

app.get('/chat/detail/:id', async (요청, 응답) => {
  let result = await db.collection('chatroom').findOne({_id :
  new ObjectId(요청.params.id) })
  응답.render('chatDetail.ejs', {result : result})
})

io.on('connection',(socket)=>{

  socket.on('ask-join', (data)=>{
    socket.join(data)
  })

  socket.on('message-send', (data)=>{
    io.to(data.room).emit('message-broadcast', data.msg)
  })
})

app.get('/stream/list',(요청, 응답)=>{
  응답.writeHead(200, {
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  })

  

changeStream.on('change', (result) => {
  console.log('DB변동생김')
  응답.write('event: msg\n')
  응답.write(`data: ${JSON.stringify(result.fullDocument)}\n\n`)
})
})

