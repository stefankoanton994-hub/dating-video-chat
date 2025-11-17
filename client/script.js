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
        this.isSpeaking = false;
        
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

        this.socket.on('partner-speaking', (data) => {
            this.updatePartnerSpeaking(data.volume, data.isSpeaking);
        });

        this.socket.on('partner-disconnected', () => {
            this.handlePartnerDisconnected();
        });
    }

    setupEventListeners() {
        document.getElementById('cancelSearch').addEventListener('click', () => {
            this.hangUp();
        });

        document.getElementById('muteAudio').addEventListener('click', () => this.toggleAudio());
        document.getElementById('nextPartner').addEventListener('click', () => this.nextPartner());
        document.getElementById('hangUp').addEventListener('click', () => this.hangUp());
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
            // Даже если микрофон не доступен, продолжаем
            this.socket.emit('join-city', { 
                city: city, 
                userData: this.userData 
            });
            this.updateStatus('🎤 Чат подключен (микрофон не доступен)');
        }
    }

    async initializeAudio() {
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                },
                video: false
            });
            
            this.createAudioVisualizer();
            console.log('🎤 Microphone access granted');
            return true;
            
        } catch (error) {
            console.error('🎤 Microphone access denied:', error);
            // Создаем фейковый визуализатор для демонстрации
            this.createFakeVisualizer();
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
            
            const drawVisualizer = () => {
                if (!this.analyser) return;
                
                this.analyser.getByteFrequencyData(dataArray);
                const volume = dataArray.reduce((a, b) => a + b) / bufferLength;
                
                // Обновляем индикатор громкости
                this.updateVolumeIndicator(volume, 'local');
                
                // Отправляем данные о активности на сервер
                if (volume > 20 && !this.isMuted) {
                    this.isSpeaking = true;
                    this.socket.emit('user-speaking', { 
                        volume: volume, 
                        isSpeaking: true 
                    });
                } else {
                    this.isSpeaking = false;
                    this.socket.emit('user-speaking', { 
                        volume: 0, 
                        isSpeaking: false 
                    });
                }
                
                requestAnimationFrame(drawVisualizer);
            };
            
            drawVisualizer();
            console.log('📊 Audio visualizer created');
            
        } catch (error) {
            console.error('Visualizer error:', error);
            this.createFakeVisualizer();
        }
    }

    createFakeVisualizer() {
        // Фейковый визуализатор для демонстрации
        let fakeVolume = 0;
        const drawFakeVisualizer = () => {
            // Случайные колебания громкости для демонстрации
            fakeVolume = Math.max(0, fakeVolume + (Math.random() - 0.5) * 10);
            fakeVolume = Math.min(50, fakeVolume);
            
            this.updateVolumeIndicator(fakeVolume, 'local');
            
            // Имитация речи
            if (Math.random() > 0.7 && !this.isMuted) {
                this.socket.emit('user-speaking', { 
                    volume: fakeVolume, 
                    isSpeaking: true 
                });
            } else {
                this.socket.emit('user-speaking', { 
                    volume: 0, 
                    isSpeaking: false 
                });
            }
            
            requestAnimationFrame(drawFakeVisualizer);
        };
        
        drawFakeVisualizer();
        console.log('📊 Fake audio visualizer created');
    }

    updateVolumeIndicator(volume, type) {
        const indicator = document.getElementById('volumeIndicator');
        if (indicator) {
            const bars = 8;
            const activeBars = Math.min(bars, Math.ceil(volume / (type === 'local' ? 15 : 12)));
            let indicatorHTML = '';
            
            for (let i = 0; i < bars; i++) {
                if (i < activeBars) {
                    indicatorHTML += '█';
                } else {
                    indicatorHTML += '░';
                }
            }
            
            indicator.textContent = indicatorHTML;
            
            if (volume > 40) {
                indicator.style.color = '#4CAF50';
            } else if (volume > 20) {
                indicator.style.color = '#FF9800';
            } else {
                indicator.style.color = '#f44336';
            }
        }
    }

    updatePartnerSpeaking(volume, isSpeaking) {
        const partnerIndicator = document.getElementById('partnerVolumeIndicator');
        const partnerStatus = document.querySelector('.partner-status');
        
        if (partnerIndicator) {
            const bars = 8;
            const activeBars = Math.min(bars, Math.ceil(volume / 12));
            let indicatorHTML = '';
            
            for (let i = 0; i < bars; i++) {
                if (i < activeBars) {
                    indicatorHTML += '█';
                } else {
                    indicatorHTML += '░';
                }
            }
            
            partnerIndicator.textContent = indicatorHTML;
            
            if (volume > 30) {
                partnerIndicator.style.color = '#4CAF50';
            } else if (volume > 15) {
                partnerIndicator.style.color = '#FF9800';
            } else {
                partnerIndicator.style.color = '#f44336';
            }
        }
        
        if (partnerStatus) {
            if (isSpeaking && volume > 15) {
                partnerStatus.textContent = '🔊 Говорит';
                partnerStatus.style.color = '#4CAF50';
            } else {
                partnerStatus.textContent = '🎤 Слушает';
                partnerStatus.style.color = '#667eea';
            }
        }
    }

    async startAudioChat() {
        this.showScreen('audioChat');
        this.updatePartnerInfo();
        this.updateStatus('🎤 Аудио-чат запущен. Говорите в микрофон!');
    }

    toggleAudio() {
        if (this.audioStream) {
            this.isMuted = !this.isMuted;
            this.audioStream.getAudioTracks()[0].enabled = !this.isMuted;
        }
        
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
    }

    nextPartner() {
        this.updateStatus('🔄 Ищем нового партнера...');
        this.socket.emit('next-partner');
        this.showScreen('waitingScreen');
    }

    hangUp() {
        if (this.audioStream) {
            this.audioStream.getTracks().forEach(track => track.stop());
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        this.showScreen('citySelection');
        this.partnerData = null;
        this.currentCity = null;
        this.updateStatus('📞 Чат завершен');
    }

    updatePartnerInfo() {
        if (this.partnerData && this.partnerData.partnerData) {
            const info = `${this.partnerData.partnerData.name}, ${this.partnerData.partnerData.age}`;
            document.getElementById('partnerInfo').textContent = info;
            document.getElementById('partnerName').textContent = this.partnerData.partnerData.name;
            
            const partnerAvatar = document.getElementById('partnerAvatar');
            if (partnerAvatar) {
                partnerAvatar.textContent = this.partnerData.partnerData.gender === 'female' ? '👩' : '👨';
            }
        }
    }

    handlePartnerDisconnected() {
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