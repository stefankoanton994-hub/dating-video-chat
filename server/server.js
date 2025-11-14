const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Статические файлы
app.use(express.static(path.join(__dirname, '../client')));

// Данные о пользователях и комнатах
const users = new Map();
const cityRooms = new Map();

// Доступные города
const availableCities = [
  'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань',
  'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону',
  'Уфа', 'Красноярск', 'Воронеж', 'Пермь', 'Волгоград'
];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Отправляем список городов новому пользователю
  socket.emit('cities-list', availableCities);

  socket.on('join-city', (data) => {
    const { city, userData } = data;
    
    // Сохраняем данные пользователя
    users.set(socket.id, {
      ...userData,
      city: city,
      socketId: socket.id
    });

    // Входим в комнату города
    socket.join(city);
    
    // Получаем текущих пользователей в комнате
    const roomUsers = Array.from(users.values())
      .filter(user => user.city === city && user.socketId !== socket.id);

    // Ищем партнера для соединения
    const waitingUsers = Array.from(users.values())
      .filter(user => 
        user.city === city && 
        user.socketId !== socket.id && 
        !user.partnerId
      );

    if (waitingUsers.length > 0) {
      // Нашли партнера - соединяем их
      const partner = waitingUsers[0];
      partner.partnerId = socket.id;
      users.get(socket.id).partnerId = partner.socketId;

      // Уведомляем обоих пользователей
      socket.emit('partner-found', { 
        partnerId: partner.socketId,
        partnerData: {
          name: partner.name,
          age: partner.age,
          gender: partner.gender
        }
      });

      socket.to(partner.socketId).emit('partner-found', {
        partnerId: socket.id,
        partnerData: {
          name: userData.name,
          age: userData.age,
          gender: userData.gender
        }
      });

      console.log(`Matched users: ${socket.id} and ${partner.socketId} in ${city}`);
    } else {
      // Ждем партнера
      socket.emit('waiting-for-partner');
      console.log(`User ${socket.id} waiting in ${city}`);
    }

    // Обновляем список пользователей в комнате
    socket.to(city).emit('users-in-room', roomUsers.length + 1);
  });

  // Обработка WebRTC сигналов
  socket.on('webrtc-offer', (data) => {
    socket.to(data.target).emit('webrtc-offer', {
      sdp: data.sdp,
      sender: socket.id
    });
  });

  socket.on('webrtc-answer', (data) => {
    socket.to(data.target).emit('webrtc-answer', {
      sdp: data.sdp,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Смена партнера
  socket.on('next-partner', () => {
    const user = users.get(socket.id);
    if (user && user.partnerId) {
      const partnerId = user.partnerId;
      const partner = users.get(partnerId);
      
      if (partner) {
        partner.partnerId = null;
        socket.to(partnerId).emit('partner-disconnected');
      }
      
      user.partnerId = null;
      
      // Ищем нового партнера
      socket.emit('waiting-for-partner');
      findNewPartner(socket.id, user.city);
    }
  });

  // Отправка сообщения
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    if (user && user.partnerId) {
      socket.to(user.partnerId).emit('new-message', {
        text: data.text,
        sender: user.name,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      // Уведомляем партнера
      if (user.partnerId) {
        socket.to(user.partnerId).emit('partner-disconnected');
        const partner = users.get(user.partnerId);
        if (partner) {
          partner.partnerId = null;
        }
      }

      // Удаляем из комнаты
      socket.to(user.city).emit('users-in-room', 
        Array.from(users.values()).filter(u => u.city === user.city && u.socketId !== socket.id).length
      );

      users.delete(socket.id);
    }
    console.log('User disconnected:', socket.id);
  });
});

function findNewPartner(userId, city) {
  const waitingUsers = Array.from(users.values())
    .filter(user => 
      user.city === city && 
      user.socketId !== userId && 
      !user.partnerId
    );

  if (waitingUsers.length > 0) {
    const partner = waitingUsers[0];
    const user = users.get(userId);
    
    partner.partnerId = userId;
    user.partnerId = partner.socketId;

    const userSocket = io.sockets.sockets.get(userId);
    const partnerSocket = io.sockets.sockets.get(partner.socketId);

    userSocket.emit('partner-found', {
      partnerId: partner.socketId,
      partnerData: {
        name: partner.name,
        age: partner.age,
        gender: partner.gender
      }
    });

    partnerSocket.emit('partner-found', {
      partnerId: userId,
      partnerData: {
        name: user.name,
        age: user.age,
        gender: user.gender
      }
    });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});