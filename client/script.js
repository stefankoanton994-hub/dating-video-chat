class AudioChat {
    constructor() {
        this.socket = null;
        this.audioStream = null;
        this.partnerData = null;
        this.currentCity = null;
        this.userData = null;
        this.isMuted = false;
        this.audioContext = null;
        this.analyser = null;
        
        this.initializeApp();
    }

    initializeApp() {
        this.setupEventListeners();
        this.initializeSocket();
        console.log('🎤 AudioChat initialized');
    }

    initializeSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('✅ Connected to server:', this.socket.id);
        });

        this.socket.on('cities-list', (cities) => {
            this.renderCities(cities);
        });

        this.socket.on('waiting-for-partner', () => {
            this.showScreen('waitingScreen');
            this.updateStatus('⏳ Ищем партнера для аудио-чата...');
        });

        this.socket.on('partner-found', async (data) => {
            console.log('🎯 Partner found:', data);
            this.partnerData = data;
            await this.startAudioChat();
        });

        this.socket.on('users-in-room', (count) => {
            document.getElementById('usersCount').textContent = count;
        });

        this.socket.on('partner-disconnected', () => {
            this.handlePartnerDisconnected();
        });

        this.socket.on('new-message', (data) => {
            this.displayMessage(data, 'partner');
        });
    }

    setupEventListeners() {
        document.getElementById('cancelSearch').addEventListener('click', () => {
            this.hangUp();
        });

        document.getElementById('muteAudio').addEventListener('click', () => this.toggleAudio());
        document.getElementById('nextPartner').addEventListener('click', () => this.nextPartner());
        document.getElementById('hangUp').addEventListener('click', () => this.hangUp());

        document.getElementById('sendMessage').addEventListener('click', () => this.sendMessage());
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }

    renderCities(cities) {
        const grid = document.getElementById('citiesGrid');
        grid.innerHTML = '';
        
        cities.forEach(city => {
            const button = document.createElement('button');
            button.className = 'city-btn';
            button.textContent = city;
            button.addEventListener('click', () => this.joinCity(city));
            grid.appendChild(button);
        });
    }

    async joinCity(city) {
        const name = document.getElementById('userName').value.trim();
        const age = document.getElementById('userAge').value;
        const gender = document.getElementById('userGender').value;

        if (!name || !age || !gender) {
            this.showError('Пожалуйста, заполните все поля');
            return;
        }

        if (age < 18 || age > 99) {
            this.showError('Вам должно быть от 18 до 99 лет');
            return;
        }

        this.currentCity = city;
        this.userData = { name, age: parseInt(age), gender };

        try {
            await this.initializeAudio();
            this.socket.emit('join-city', { 
                city: city, 
                userData: this.userData 
            });
            this.updateStatus('✅ Микрофон подключен');
        } catch (error) {
            console.error('Audio error:', error);
            this.showError('Не удалось подключить микрофон. Вы можете продолжить с текстовым чатом.');
            // Все равно присоединяемся к чату
            this.socket.emit('join-city', { 
                city: city, 
                userData: this.userData 
            });
        }
    }

    async initializeAudio() {
        try {
            // Запрашиваем только аудио
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                },
                video: false
            });
            
            // Создаем визуализацию звука
            this.createAudioVisualizer();
            
            console.log('🎤 Microphone access granted');
            return true;
            
        } catch (error) {
            console.error('🎤 Microphone access denied:', error);
            this.updateStatus('🔇 Микрофон недоступен (только текстовый чат)');
            return false;
        }
    }

    createAudioVisualizer() {
        if (!this.audioStream) return;
        
        try {
            this.audioContext = new AudioContext();
            this.analyser = this.audioContext.createAnalyser();
            const source = this.audioContext.createMediaStreamSource(this.audioStream);
            source.connect(this.analyser);
            
            this.analyser.fftSize = 256;
            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            // Функция для анимации визуализатора
            const drawVisualizer = () => {
                if (!this.analyser) return;
                
                this.analyser.getByteFrequencyData(dataArray);
                
                // Обновляем индикатор громкости
                const volume = dataArray.reduce((a, b) => a + b) / bufferLength;
                this.updateVolumeIndicator(volume);
                
                requestAnimationFrame(drawVisualizer);
            };
            
            drawVisualizer();
            console.log('📊 Audio visualizer created');
            
        } catch (error) {
            console.error('Visualizer error:', error);
        }
    }

    updateVolumeIndicator(volume) {
        const indicator = document.getElementById('volumeIndicator');
        if (indicator) {
            const bars = 5;
            const activeBars = Math.min(bars, Math.ceil(volume / 20));
            let indicatorHTML = '';
            
            for (let i = 0; i < bars; i++) {
                if (i < activeBars) {
                    indicatorHTML += '█';
                } else {
                    indicatorHTML += '░';
                }
            }
            
            indicator.textContent = indicatorHTML;
        }
    }

    async startAudioChat() {
        this.showScreen('audioChat');
        this.updatePartnerInfo();
        
        this.displayMessage({
            text: `Вы connected с ${this.partnerData.partnerData.name}. Начинайте общение!`,
            sender: 'Система',
            timestamp: new Date().toLocaleTimeString()
        }, 'system-message');
        
        this.updateStatus('🎤 Аудио-чат запущен. Говорите!');
        
        // Запускаем индикатор звука
        this.startAudioMonitoring();
    }

    startAudioMonitoring() {
        // Индикатор что аудио работает
        const audioStatus = document.getElementById('audioStatus');
        if (audioStatus) {
            audioStatus.textContent = '🔊 Аудио активно';
            audioStatus.className = 'status-active';
        }
    }

    toggleAudio() {
        if (this.audioStream) {
            this.isMuted = !this.isMuted;
            this.audioStream.getAudioTracks()[0].enabled = !this.isMuted;
            
            const button = document.getElementById('muteAudio');
            const status = document.getElementById('audioStatus');
            
            if (this.isMuted) {
                button.textContent = '🔇';
                button.className = 'control-btn muted';
                if (status) {
                    status.textContent = '🔇 Микрофон выключен';
                    status.className = 'status-muted';
                }
                this.updateStatus('🔇 Микрофон выключен');
            } else {
                button.textContent = '🎤';
                button.className = 'control-btn';
                if (status) {
                    status.textContent = '🔊 Аудио активно';
                    status.className = 'status-active';
                }
                this.updateStatus('🎤 Микрофон включен');
            }
        } else {
            this.updateStatus('🎤 Микрофон недоступен');
        }
    }

    nextPartner() {
        this.updateStatus('🔄 Ищем нового партнера...');
        this.socket.emit('next-partner');
        this.showScreen('waitingScreen');
        this.clearChat();
    }

    hangUp() {
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        this.showScreen('citySelection');
        this.clearChat();
        this.partnerData = null;
        this.currentCity = null;
        this.updateStatus('📞 Звонок завершен');
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();
        
        if (text && this.partnerData) {
            this.socket.emit('send-message', { text });
            this.displayMessage({
                text: text,
                sender: this.userData.name,
                timestamp: new Date().toLocaleTimeString()
            }, 'own');
            input.value = '';
        }
    }

    displayMessage(data, type) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        messageDiv.innerHTML = `
            <div class="message-sender">${data.sender}</div>
            <div class="message-text">${data.text}</div>
            <div class="message-time">${data.timestamp}</div>
        `;
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    clearChat() {
        document.getElementById('chatMessages').innerHTML = 
            '<div class="system-message">Аудио-чат подключен. Говорите в микрофон и общайтесь в чате!</div>';
    }

    updatePartnerInfo() {
        if (this.partnerData && this.partnerData.partnerData) {
            const info = `${this.partnerData.partnerData.name}, ${this.partnerData.partnerData.age}`;
            document.getElementById('partnerInfo').textContent = info;
            document.getElementById('partnerName').textContent = this.partnerData.partnerData.name;
            
            // Устанавливаем аватарку по полу
            const partnerAvatar = document.getElementById('partnerAvatar');
            if (partnerAvatar) {
                partnerAvatar.textContent = this.partnerData.partnerData.gender === 'female' ? '👩' : '👨';
            }
        }
    }

    handlePartnerDisconnected() {
        this.displayMessage({
            text: 'Партнер отключился. Ищем нового...',
            sender: 'Система',
            timestamp: new Date().toLocaleTimeString()
        }, 'system-message');
        
        this.updateStatus('❌ Партнер отключился');
        
        setTimeout(() => {
            this.nextPartner();
        }, 2000);
    }

    updateStatus(message) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = message;
        }
        console.log('Status:', message);
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
    }

    showError(message) {
        const errorDiv = document.getElementById('formError');
        errorDiv.textContent = message;
        setTimeout(() => errorDiv.textContent = '', 5000);
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new AudioChat();
});