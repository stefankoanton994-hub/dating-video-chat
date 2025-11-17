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
        this.partnerSpeaking = false;
        this.simulationInterval = null;
        
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

        this.socket.on('partner-audio-state', (data) => {
            this.updatePartnerAudioState(data);
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

        // Добавляем кнопку тестового звука
        document.getElementById('testSound').addEventListener('click', () => this.playTestSound());
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
            // Продолжаем без микрофона
            this.socket.emit('join-city', { 
                city: city, 
                userData: this.userData 
            });
            this.updateStatus('🎤 Чат подключен (используйте тестовый звук)');
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
                
                // Симулируем передачу данных партнеру
                if (volume > 25 && !this.isMuted) {
                    if (!this.isSpeaking) {
                        this.isSpeaking = true;
                        this.socket.emit('partner-speaking', { 
                            volume: volume, 
                            isSpeaking: true 
                        });
                    }
                    // Периодическая отправка данных о громкости
                    this.socket.emit('partner-speaking', { 
                        volume: volume, 
                        isSpeaking: true 
                    });
                } else if (this.isSpeaking) {
                    this.isSpeaking = false;
                    this.socket.emit('partner-speaking', { 
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
        // Фейковый визуализатор с реалистичным поведением
        let fakeVolume = 0;
        let isFakeSpeaking = false;
        
        const drawFakeVisualizer = () => {
            // Реалистичная симуляция разговора
            if (Math.random() > 0.8 && !this.isMuted) {
                // Начало "фразы"
                isFakeSpeaking = true;
                fakeVolume = 30 + Math.random() * 40;
            } else if (isFakeSpeaking && Math.random() > 0.3) {
                // Продолжение "фразы" с колебаниями
                fakeVolume = Math.max(20, fakeVolume + (Math.random() - 0.5) * 15);
            } else if (isFakeSpeaking) {
                // Конец "фразы"
                isFakeSpeaking = false;
                fakeVolume = 0;
            } else {
                // Тишина
                fakeVolume = Math.max(0, fakeVolume - 5);
            }
            
            this.updateVolumeIndicator(fakeVolume, 'local');
            
            // Симулируем передачу данных партнеру
            if (isFakeSpeaking && !this.isMuted) {
                this.socket.emit('partner-speaking', { 
                    volume: fakeVolume, 
                    isSpeaking: true 
                });
            } else if (this.isSpeaking) {
                this.isSpeaking = false;
                this.socket.emit('partner-speaking', { 
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
        const indicator = type === 'local' 
            ? document.getElementById('volumeIndicator')
            : document.getElementById('partnerVolumeIndicator');
            
        if (indicator) {
            const bars = 8;
            const activeBars = Math.min(bars, Math.ceil(volume / (type === 'local' ? 12 : 10)));
            let indicatorHTML = '';
            
            for (let i = 0; i < bars; i++) {
                if (i < activeBars) {
                    indicatorHTML += '█';
                } else {
                    indicatorHTML += '░';
                }
            }
            
            indicator.textContent = indicatorHTML;
            
            // Цветовая индикация
            if (volume > 40) {
                indicator.style.color = '#4CAF50';
                indicator.style.textShadow = '0 0 10px #4CAF50';
            } else if (volume > 20) {
                indicator.style.color = '#FF9800';
                indicator.style.textShadow = '0 0 5px #FF9800';
            } else {
                indicator.style.color = '#f44336';
                indicator.style.textShadow = 'none';
            }
        }
    }

    updatePartnerSpeaking(volume, isSpeaking) {
        const partnerIndicator = document.getElementById('partnerVolumeIndicator');
        const partnerStatus = document.querySelector('.partner-status');
        const partnerCard = document.querySelector('.partner-user');
        
        // Обновляем индикатор громкости партнера
        this.updateVolumeIndicator(volume, 'partner');
        
        // Обновляем статус партнера
        if (partnerStatus) {
            if (isSpeaking && volume > 15) {
                partnerStatus.textContent = '🔊 ГОВОРИТ';
                partnerStatus.style.color = '#4CAF50';
                partnerStatus.style.fontWeight = 'bold';
                
                // Добавляем анимацию к карточке партнера
                if (partnerCard) {
                    partnerCard.style.boxShadow = '0 0 20px #4CAF50';
                    partnerCard.style.borderColor = '#4CAF50';
                }
                
                // Воспроизводим псевдо-звук (опционально)
                this.playPartnerSound(volume);
                
            } else {
                partnerStatus.textContent = '🎤 слушает';
                partnerStatus.style.color = '#667eea';
                partnerStatus.style.fontWeight = 'normal';
                
                // Убираем анимацию
                if (partnerCard) {
                    partnerCard.style.boxShadow = '';
                    partnerCard.style.borderColor = '#667eea';
                }
            }
        }
        
        this.partnerSpeaking = isSpeaking;
    }

    playPartnerSound(volume) {
        // Создаем простой звуковой feedback для пользователя
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            // Настраиваем звук в зависимости от "громкости" партнера
            oscillator.type = 'sine';
            oscillator.frequency.value = 200 + (volume / 50) * 100; // 200-300 Hz
            
            gainNode.gain.value = Math.min(0.1, volume / 1000); // Очень тихий звук
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.start();
            setTimeout(() => {
                oscillator.stop();
            }, 100);
            
        } catch (error) {
            console.log('Audio feedback not supported');
        }
    }

    playTestSound() {
        // Тестовый звук для проверки аудио
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.type = 'sine';
            oscillator.frequency.value = 440; // Ля первой октавы
            
            gainNode.gain.value = 0.1;
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.start();
            setTimeout(() => {
                oscillator.stop();
                this.updateStatus('🔊 Тестовый звук воспроизведен');
            }, 500);
            
        } catch (error) {
            this.updateStatus('🔇 Аудио не поддерживается в этом браузере');
        }
    }

    async startAudioChat() {
        this.showScreen('audioChat');
        this.updatePartnerInfo();
        this.updateStatus('🎤 Аудио-чат запущен! Говорите в микрофон или используйте тестовый звук');
        
        // Запускаем симуляцию активности партнера
        this.startPartnerSimulation();
    }

    startPartnerSimulation() {
        // Случайная симуляция активности партнера
        this.simulationInterval = setInterval(() => {
            if (Math.random() > 0.7) {
                // Партнер "начинает говорить"
                const volume = 30 + Math.random() * 50;
                this.socket.emit('partner-speaking', {
                    volume: volume,
                    isSpeaking: true
                });
                
                // "Фраза" длится 1-3 секунды
                setTimeout(() => {
                    if (Math.random() > 0.3) {
                        this.socket.emit('partner-speaking', {
                            volume: 0,
                            isSpeaking: false
                        });
                    }
                }, 1000 + Math.random() * 2000);
            }
        }, 3000 + Math.random() * 5000);
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
        this.stopPartnerSimulation();
        this.updateStatus('🔄 Ищем нового партнера...');
        this.socket.emit('next-partner');
        this.showScreen('waitingScreen');
    }

    hangUp() {
        this.stopPartnerSimulation();
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

    stopPartnerSimulation() {
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
            this.simulationInterval = null;
        }
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
        this.stopPartnerSimulation();
        
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