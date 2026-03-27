/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, Trophy, Cpu, User, Volume2, VolumeX, Heart } from 'lucide-react';

// --- Constants ---
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 500;
const PADDLE_WIDTH = 10;
const PADDLE_HEIGHT = 80;
const BALL_SIZE = 15;
const INITIAL_BALL_SPEED = 2;
const PADDLE_SPEED = 5.6;
const AI_SPEED = 4.2;

// --- Brick Constants ---
const BRICK_ROWS = 8;
const BRICK_WIDTH = 15;
const BRICK_HEIGHT = 50;
const BRICK_PADDING = 8;

type BrickType = 'NORMAL' | 'BIG_PADDLE' | 'GOLDEN' | 'MAGNET' | 'MULTIPLIER' | 'LASER';

// --- Sound Engine ---
class SoundEngine {
  private ctx: AudioContext | null = null;

  private init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
  }

  private playTone(freq: number, type: OscillatorType, duration: number, volume: number = 0.1) {
    this.init();
    if (!this.ctx) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);

    gain.gain.setValueAtTime(volume, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start();
    osc.stop(this.ctx.currentTime + duration);
  }

  playHit() {
    this.playTone(440, 'square', 0.1, 0.05);
  }

  playWall() {
    this.playTone(220, 'sine', 0.1, 0.05);
  }

  playBrick() {
    this.playTone(880, 'square', 0.05, 0.03);
  }

  playPowerUp() {
    this.playTone(523.25, 'sine', 0.1, 0.1);
    setTimeout(() => this.playTone(783.99, 'sine', 0.2, 0.1), 50);
  }

  playScore() {
    this.playTone(523.25, 'triangle', 0.3, 0.1); // C5
    setTimeout(() => this.playTone(659.25, 'triangle', 0.3, 0.1), 100); // E5
  }

  playLaser() {
    this.playTone(1200, 'sawtooth', 0.05, 0.02);
  }

  playGameOver(win: boolean) {
    if (win) {
      [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
        setTimeout(() => this.playTone(f, 'triangle', 0.5, 0.1), i * 150);
      });
    } else {
      [392.00, 349.23, 329.63, 261.63].forEach((f, i) => {
        setTimeout(() => this.playTone(f, 'sawtooth', 0.5, 0.05), i * 150);
      });
    }
  }
}

const sound = new SoundEngine();

type GameState = 'START' | 'PLAYING' | 'GAME_OVER';

interface Brick {
  x: number;
  y: number;
  active: boolean;
  color: string;
  type: BrickType;
}

interface GameNotification {
  id: number;
  text: string;
  color: string;
}

interface Laser {
  x: number;
  y: number;
  vx: number;
  owner: 'PLAYER' | 'AI';
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('START');
  const [level, setLevel] = useState(1);
  const [playerScore, setPlayerScore] = useState(0);
  const [aiScore, setAiScore] = useState(0);
  const [winner, setWinner] = useState<'PLAYER' | 'AI' | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isServing, setIsServing] = useState(true);
  const [currentServer, setCurrentServer] = useState<'PLAYER' | 'AI'>('PLAYER');
  const [notifications, setNotifications] = useState<GameNotification[]>([]);
  const [isShaking, setIsShaking] = useState(false);

  const [isAiMode, setIsAiMode] = useState(false);

  // Latest state ref to avoid stale closures and effect re-runs
  const latestState = useRef({
    gameState,
    isServing,
    isMuted,
    currentServer,
    activePowerUps,
    level,
    isAiMode,
    playerScore,
    aiScore
  });

  useEffect(() => {
    latestState.current = {
      gameState,
      isServing,
      isMuted,
      currentServer,
      activePowerUps,
      level,
      isAiMode,
      playerScore,
      aiScore
    };
  }, [gameState, isServing, isMuted, currentServer, activePowerUps, level, isAiMode, playerScore, aiScore]);

  const addNotification = (text: string, color: string) => {
    const id = Date.now();
    setNotifications(prev => [...prev, { id, text, color }]);
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 150);
    setTimeout(() => {
      setNotifications(prev => prev.filter(n => n.id !== id));
    }, 2000);
  };
  const [activePowerUps, setActivePowerUps] = useState<{
    player: { big: number; magnet: boolean; multiplier: number; laser: number };
    ai: { big: number; magnet: boolean; multiplier: number; laser: number };
  }>({
    player: { big: 0, magnet: false, multiplier: 0, laser: 0 },
    ai: { big: 0, magnet: false, multiplier: 0, laser: 0 }
  });

  // Game state refs to avoid closure issues in the loop
  const ballPos = useRef({ x: PADDLE_WIDTH + 5, y: CANVAS_HEIGHT / 2 });
  const ballVel = useRef({ x: INITIAL_BALL_SPEED, y: INITIAL_BALL_SPEED });
  const ballColor = useRef('#00f2ff'); // Start as Blue (Player color)
  const lastHitter = useRef<'PLAYER' | 'AI'>('PLAYER');
  const playerY = useRef(CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2);
  const aiY = useRef(CANVAS_HEIGHT / 2 - PADDLE_HEIGHT / 2);
  const bricks = useRef<Brick[]>([]);
  const lasers = useRef<Laser[]>([]);
  const keysPressed = useRef<Set<string>>(new Set());
  const lastSpacePressed = useRef(false);
  const serveTimer = useRef<number>(0);
  const isBallMagnetized = useRef(false);
  const magnetTimer = useRef(0);

  const initBricks = (currentLevel: number) => {
    const dynamicBrickCols = 3 + (currentLevel - 1) * 2;
    const totalWidth = dynamicBrickCols * BRICK_WIDTH + (dynamicBrickCols - 1) * BRICK_PADDING;
    const startX = (CANVAS_WIDTH - totalWidth) / 2;
    const totalHeight = BRICK_ROWS * BRICK_HEIGHT + (BRICK_ROWS - 1) * BRICK_PADDING;
    const startY = (CANVAS_HEIGHT - totalHeight) / 2;

    const specialTypes: BrickType[] = ['GOLDEN', 'BIG_PADDLE', 'MAGNET', 'MULTIPLIER', 'LASER'];
    const specialIndices = new Set<number>();
    while (specialIndices.size < specialTypes.length) {
      specialIndices.add(Math.floor(Math.random() * (dynamicBrickCols * BRICK_ROWS)));
    }

    const specialAssignments = Array.from(specialIndices).map((brickIdx, i) => ({
      brickIdx,
      type: specialTypes[i]
    }));

    const newBricks: Brick[] = [];
    let currentIdx = 0;
    for (let c = 0; c < dynamicBrickCols; c++) {
      for (let r = 0; r < BRICK_ROWS; r++) {
        const assignment = specialAssignments.find(a => a.brickIdx === currentIdx);
        const type: BrickType = assignment ? assignment.type : 'NORMAL';

        newBricks.push({
          x: startX + c * (BRICK_WIDTH + BRICK_PADDING),
          y: startY + r * (BRICK_HEIGHT + BRICK_PADDING),
          active: true,
          color: c % 2 === 0 ? '#ff00ff' : '#00ffff', // Alternating neon colors
          type
        });
        currentIdx++;
      }
    }
    bricks.current = newBricks;
  };

  const resetBall = (server: 'PLAYER' | 'AI') => {
    setIsServing(true);
    setCurrentServer(server);
    serveTimer.current = 0;
    isBallMagnetized.current = false;
    lasers.current = [];
    setActivePowerUps({
      player: { big: 0, magnet: false, multiplier: 0, laser: 0 },
      ai: { big: 0, magnet: false, multiplier: 0, laser: 0 }
    });
    
    const currentBallSpeed = INITIAL_BALL_SPEED * (1 + (level - 1) * 0.5 / 9);

    if (server === 'PLAYER') {
      ballPos.current = { 
        x: PADDLE_WIDTH + 5, 
        y: playerY.current + PADDLE_HEIGHT / 2 - BALL_SIZE / 2
      };
      const serveAngle = (Math.random() - 0.5) * (Math.PI / 4); // Max 22.5 degrees
      ballVel.current = {
        x: Math.cos(serveAngle) * currentBallSpeed,
        y: Math.sin(serveAngle) * currentBallSpeed,
      };
      ballColor.current = '#00f2ff'; // Reset to Blue
      lastHitter.current = 'PLAYER';
    } else {
      ballPos.current = { 
        x: CANVAS_WIDTH - PADDLE_WIDTH - BALL_SIZE - 5, 
        y: aiY.current + PADDLE_HEIGHT / 2 - BALL_SIZE / 2
      };
      const serveAngle = (Math.random() - 0.5) * (Math.PI / 4); // Max 22.5 degrees
      ballVel.current = {
        x: -Math.cos(serveAngle) * currentBallSpeed,
        y: Math.sin(serveAngle) * currentBallSpeed,
      };
      ballColor.current = '#ff007a'; // Reset to Red
      lastHitter.current = 'AI';
    }
  };

  const startGame = (aiMode: boolean = false) => {
    setPlayerScore(0);
    setAiScore(0);
    setWinner(null);
    setLevel(1);
    initBricks(1);
    setGameState('PLAYING');
    setIsServing(true);
    setIsAiMode(aiMode);
    resetBall('PLAYER');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current.add(e.key);
      if (e.key.toLowerCase() === 'e') {
        if (isAiMode) {
          setGameState('START');
          setIsAiMode(false);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => keysPressed.current.delete(e.key);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (gameState !== 'PLAYING') return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const update = () => {
      const { 
        isServing: currentIsServing, 
        currentServer: currentServerVal, 
        activePowerUps: currentPowerUps, 
        level: currentLevel, 
        isAiMode: currentAiMode,
        isMuted: currentIsMuted,
        playerScore: currentPlayerScore,
        aiScore: currentAiScore
      } = latestState.current;

      // Serve Mechanic
      const playerPaddleHeight = currentPowerUps.player.big > 0 ? PADDLE_HEIGHT * 1.5 : PADDLE_HEIGHT;
      const aiPaddleHeight = currentPowerUps.ai.big > 0 ? PADDLE_HEIGHT * 1.5 : PADDLE_HEIGHT;
      const currentBallSpeed = INITIAL_BALL_SPEED * (1 + (currentLevel - 1) * 0.5 / 9);

      if (currentIsServing) {
        if (currentServerVal === 'PLAYER') {
          ballPos.current.y = playerY.current + playerPaddleHeight / 2 - BALL_SIZE / 2;
          if (currentAiMode) {
            serveTimer.current++;
            if (serveTimer.current > 60) {
              setIsServing(false);
              serveTimer.current = 0;
            }
          } else if (keysPressed.current.size > 0) {
            setIsServing(false);
          }
        } else {
          ballPos.current.y = aiY.current + aiPaddleHeight / 2 - BALL_SIZE / 2;
          serveTimer.current++;
          if (serveTimer.current > 60) { // AI serves after ~1 second
            setIsServing(false);
            serveTimer.current = 0;
          }
        }
      }

      // Magnet Mechanic
      if (isBallMagnetized.current) {
        if (lastHitter.current === 'PLAYER') {
          ballPos.current.y = playerY.current + magnetTimer.current;
          if (currentAiMode) {
            serveTimer.current++;
            if (serveTimer.current > 60) {
              isBallMagnetized.current = false;
              ballVel.current.x = Math.abs(ballVel.current.x);
              serveTimer.current = 0;
            }
          } else if (keysPressed.current.has(' ')) {
            isBallMagnetized.current = false;
            ballVel.current.x = Math.abs(ballVel.current.x);
          }
        } else {
          ballPos.current.y = aiY.current + magnetTimer.current;
          serveTimer.current++;
          if (serveTimer.current > 60) {
            isBallMagnetized.current = false;
            ballVel.current.x = -Math.abs(ballVel.current.x);
            serveTimer.current = 0;
          }
        }
      }

      // Player Movement
      if (currentAiMode) {
        if (!currentIsServing && !isBallMagnetized.current) {
          const playerCenter = playerY.current + playerPaddleHeight / 2;
          if (playerCenter < ballPos.current.y - 10) {
            playerY.current = Math.min(CANVAS_HEIGHT - playerPaddleHeight, playerY.current + AI_SPEED);
          } else if (playerCenter > ballPos.current.y + 10) {
            playerY.current = Math.max(0, playerY.current - AI_SPEED);
          }
        }
      } else {
        if (keysPressed.current.has('ArrowUp') || keysPressed.current.has('w')) {
          playerY.current = Math.max(0, playerY.current - PADDLE_SPEED);
        }
        if (keysPressed.current.has('ArrowDown') || keysPressed.current.has('s')) {
          playerY.current = Math.min(CANVAS_HEIGHT - playerPaddleHeight, playerY.current + PADDLE_SPEED);
        }
      }

      // AI Movement (Simple follow)
      if (!currentIsServing && !isBallMagnetized.current) {
        const aiCenter = aiY.current + aiPaddleHeight / 2;
        if (aiCenter < ballPos.current.y - 10) {
          aiY.current = Math.min(CANVAS_HEIGHT - aiPaddleHeight, aiY.current + AI_SPEED);
        } else if (aiCenter > ballPos.current.y + 10) {
          aiY.current = Math.max(0, aiY.current - AI_SPEED);
        }
      }

      // Laser Shooting
      if (activePowerUps.player.laser > 0) {
        if (isAiMode) {
          if (Math.random() < 0.05) {
            lasers.current.push({
              x: PADDLE_WIDTH,
              y: playerY.current + playerPaddleHeight / 2,
              vx: 10,
              owner: 'PLAYER'
            });
            if (!isMuted) sound.playLaser();
          }
        } else {
          const isSpacePressed = keysPressed.current.has(' ');
          if (isSpacePressed && !lastSpacePressed.current) {
            lasers.current.push({
              x: PADDLE_WIDTH,
              y: playerY.current + playerPaddleHeight / 2,
              vx: 10,
              owner: 'PLAYER'
            });
            if (!isMuted) sound.playLaser();
          }
          lastSpacePressed.current = isSpacePressed;
        }
      }

      if (activePowerUps.ai.laser > 0) {
        if (Math.random() < 0.05) {
          lasers.current.push({
            x: CANVAS_WIDTH - PADDLE_WIDTH,
            y: aiY.current + aiPaddleHeight / 2,
            vx: -10,
            owner: 'AI'
          });
          if (!isMuted) sound.playLaser();
        }
      }

      lasers.current = lasers.current.filter(laser => {
        laser.x += laser.vx;
        for (const brick of bricks.current) {
          if (!brick.active) continue;
          if (
            laser.x >= brick.x &&
            laser.x <= brick.x + BRICK_WIDTH &&
            laser.y >= brick.y &&
            laser.y <= brick.y + BRICK_HEIGHT
          ) {
            brick.active = false;
            if (!isMuted) sound.playBrick();
            if (laser.owner === 'PLAYER') {
              const points = brick.type === 'GOLDEN' ? 10 : 1;
              const multiplier = activePowerUps.player.multiplier > 0 ? 3 : 1;
              setPlayerScore(s => s + points * multiplier);
            } else {
              const points = brick.type === 'GOLDEN' ? 10 : 1;
              const multiplier = activePowerUps.ai.multiplier > 0 ? 3 : 1;
              setAiScore(s => s + points * multiplier);
            }
            return false;
          }
        }
        return laser.x > 0 && laser.x < CANVAS_WIDTH;
      });

      // Ball Movement
      if (!isServing && !isBallMagnetized.current) {
        ballPos.current.x += ballVel.current.x;
        ballPos.current.y += ballVel.current.y;
      }

      // Power-up Timers
      setActivePowerUps(prev => ({
        player: {
          ...prev.player,
          big: Math.max(0, prev.player.big - 1),
          multiplier: Math.max(0, prev.player.multiplier - 1),
          laser: Math.max(0, prev.player.laser - 1)
        },
        ai: {
          ...prev.ai,
          big: Math.max(0, prev.ai.big - 1),
          multiplier: Math.max(0, prev.ai.multiplier - 1),
          laser: Math.max(0, prev.ai.laser - 1)
        }
      }));

      // Wall Collisions (Top/Bottom)
      if (ballPos.current.y <= 0) {
        ballPos.current.y = 0;
        ballVel.current.y *= -1;
        if (!isMuted) sound.playWall();
      } else if (ballPos.current.y >= CANVAS_HEIGHT - BALL_SIZE) {
        ballPos.current.y = CANVAS_HEIGHT - BALL_SIZE;
        ballVel.current.y *= -1;
        if (!isMuted) sound.playWall();
      }

      // Brick Collisions
      for (const brick of bricks.current) {
        if (!brick.active) continue;

        if (
          ballPos.current.x + BALL_SIZE >= brick.x &&
          ballPos.current.x <= brick.x + BRICK_WIDTH &&
          ballPos.current.y + BALL_SIZE >= brick.y &&
          ballPos.current.y <= brick.y + BRICK_HEIGHT
        ) {
          brick.active = false;
          ballVel.current.x *= -1;
          
          // Power-up logic
          if (brick.type !== 'NORMAL') {
            const info = {
              GOLDEN: { label: 'GOLDEN BRICK +10', color: '#ffd700' },
              BIG_PADDLE: { label: 'BIG PADDLE', color: '#00ff00' },
              MAGNET: { label: 'MAGNET ACTIVATED', color: '#ff8c00' },
              MULTIPLIER: { label: '3X SCORE MULTIPLIER', color: '#ff00ff' },
              LASER: { label: 'PEW PEW! LASERS ON', color: '#ff0000' },
              NORMAL: { label: '', color: '' }
            }[brick.type];
            
            if (info.label) {
              addNotification(info.label, info.color);
            }
          }

          if (lastHitter.current === 'PLAYER') {
            const points = brick.type === 'GOLDEN' ? 10 : 1;
            const multiplier = activePowerUps.player.multiplier > 0 ? 3 : 1;
            setPlayerScore((s) => s + points * multiplier);
            
            if (brick.type !== 'NORMAL') {
              if (!isMuted) sound.playPowerUp();
              if (brick.type === 'BIG_PADDLE') setActivePowerUps(p => ({ ...p, player: { ...p.player, big: 600 } })); // 10s
              if (brick.type === 'MAGNET') setActivePowerUps(p => ({ ...p, player: { ...p.player, magnet: true } }));
              if (brick.type === 'MULTIPLIER') setActivePowerUps(p => ({ ...p, player: { ...p.player, multiplier: 600 } })); // 10s
              if (brick.type === 'LASER') setActivePowerUps(p => ({ ...p, player: { ...p.player, laser: 300 } })); // 5s
            }
          } else {
            const points = brick.type === 'GOLDEN' ? 10 : 1;
            const multiplier = activePowerUps.ai.multiplier > 0 ? 3 : 1;
            setAiScore((s) => s + points * multiplier);
            
            if (brick.type !== 'NORMAL') {
              if (!isMuted) sound.playPowerUp();
              if (brick.type === 'BIG_PADDLE') setActivePowerUps(p => ({ ...p, ai: { ...p.ai, big: 600 } }));
              if (brick.type === 'MAGNET') setActivePowerUps(p => ({ ...p, ai: { ...p.ai, magnet: true } }));
              if (brick.type === 'MULTIPLIER') setActivePowerUps(p => ({ ...p, ai: { ...p.ai, multiplier: 600 } }));
              if (brick.type === 'LASER') setActivePowerUps(p => ({ ...p, ai: { ...p.ai, laser: 300 } })); // 5s
            }
          }
          
          if (!isMuted) sound.playBrick();
          
          break; // Only hit one brick per frame
        }
      }

      // Paddle Collisions
      // Player Paddle
      if (
        ballPos.current.x <= PADDLE_WIDTH &&
        ballPos.current.y + BALL_SIZE >= playerY.current &&
        ballPos.current.y <= playerY.current + playerPaddleHeight
      ) {
        if (activePowerUps.player.magnet) {
          isBallMagnetized.current = true;
          magnetTimer.current = ballPos.current.y - playerY.current;
          setActivePowerUps(p => ({ ...p, player: { ...p.player, magnet: false } }));
        }

        // Calculate bounce angle
        const deltaY = (ballPos.current.y + BALL_SIZE / 2) - (playerY.current + playerPaddleHeight / 2);
        const normalizedDeltaY = deltaY / (playerPaddleHeight / 2);
        const bounceAngle = normalizedDeltaY * (Math.PI / 4); // Max 45 degrees

        ballVel.current.x = Math.cos(bounceAngle) * currentBallSpeed;
        ballVel.current.y = Math.sin(bounceAngle) * currentBallSpeed;
        
        // Push ball out of paddle to prevent sticking
        ballPos.current.x = PADDLE_WIDTH + 1;
        
        // Update color and hitter
        ballColor.current = '#00f2ff'; // Cyan/Blue
        lastHitter.current = 'PLAYER';
        
        if (!isMuted) sound.playHit();
      }

      // AI Paddle
      if (
        ballPos.current.x >= CANVAS_WIDTH - PADDLE_WIDTH - BALL_SIZE &&
        ballPos.current.y + BALL_SIZE >= aiY.current &&
        ballPos.current.y <= aiY.current + aiPaddleHeight
      ) {
        if (activePowerUps.ai.magnet) {
          isBallMagnetized.current = true;
          magnetTimer.current = ballPos.current.y - aiY.current;
          setActivePowerUps(p => ({ ...p, ai: { ...p.ai, magnet: false } }));
        }

        // Calculate bounce angle
        const deltaY = (ballPos.current.y + BALL_SIZE / 2) - (aiY.current + aiPaddleHeight / 2);
        const normalizedDeltaY = deltaY / (aiPaddleHeight / 2);
        const bounceAngle = normalizedDeltaY * (Math.PI / 4); // Max 45 degrees

        ballVel.current.x = -Math.cos(bounceAngle) * currentBallSpeed;
        ballVel.current.y = Math.sin(bounceAngle) * currentBallSpeed;

        // Push ball out of paddle to prevent sticking
        ballPos.current.x = CANVAS_WIDTH - PADDLE_WIDTH - BALL_SIZE - 1;
        
        // Update color and hitter
        ballColor.current = '#ff007a'; // Pink/Red
        lastHitter.current = 'AI';
        
        if (!isMuted) sound.playHit();
      }

      // Scoring / Lives
      if (ballPos.current.x <= 0) {
        if (!isMuted) sound.playScore();
        resetBall('AI'); // Switch serve to AI
      } else if (ballPos.current.x >= CANVAS_WIDTH) {
        if (!isMuted) sound.playScore();
        resetBall('PLAYER'); // Switch serve to Player
      }

      // Check for game over or next level (all bricks gone)
      const activeBricks = bricks.current.filter(b => b.active).length;
      if (activeBricks === 0 && gameState === 'PLAYING') {
        if (level < 10) {
          const nextLevel = level + 1;
          setLevel(nextLevel);
          initBricks(nextLevel);
          resetBall(currentServer);
          addNotification(`LEVEL ${nextLevel}`, '#ffffff');
        } else {
          if (isAiMode) {
            // Restart from level 1
            setLevel(1);
            initBricks(1);
            resetBall('PLAYER');
            addNotification('AI MODE RESTART', '#ffffff');
          } else {
            setWinner(playerScore >= aiScore ? 'PLAYER' : 'AI');
            setGameState('GAME_OVER');
            if (!isMuted) sound.playGameOver(playerScore >= aiScore);
          }
        }
      }
    };

    const draw = () => {
      ctx.fillStyle = '#0a0a0a';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw Center Line
      ctx.setLineDash([10, 10]);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.beginPath();
      ctx.moveTo(CANVAS_WIDTH / 2, 0);
      ctx.lineTo(CANVAS_WIDTH / 2, CANVAS_HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Bricks
      for (const brick of bricks.current) {
        if (!brick.active) continue;
        
        const isSpecial = brick.type !== 'NORMAL';
        const pulse = isSpecial ? Math.sin(Date.now() / 200) * 5 + 15 : 10;
        ctx.shadowBlur = pulse;
        
        // Special brick colors
        if (brick.type === 'GOLDEN') {
          ctx.fillStyle = '#ffd700';
          ctx.shadowColor = '#ffd700';
        } else if (brick.type === 'BIG_PADDLE') {
          ctx.fillStyle = '#00ff00';
          ctx.shadowColor = '#00ff00';
        } else if (brick.type === 'MAGNET') {
          ctx.fillStyle = '#ff8c00';
          ctx.shadowColor = '#ff8c00';
        } else if (brick.type === 'MULTIPLIER') {
          ctx.fillStyle = '#ff00ff';
          ctx.shadowColor = '#ff00ff';
        } else if (brick.type === 'LASER') {
          ctx.fillStyle = '#ff0000';
          ctx.shadowColor = '#ff0000';
        } else {
          ctx.fillStyle = brick.color;
          ctx.shadowColor = brick.color;
          ctx.shadowBlur = 5; // Less blur for normal bricks
        }
        
        ctx.fillRect(brick.x, brick.y, BRICK_WIDTH, BRICK_HEIGHT);
        
        // Enhanced glow for special bricks
        if (isSpecial) {
          // Outer border glow
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
          ctx.lineWidth = 2;
          ctx.strokeRect(brick.x, brick.y, BRICK_WIDTH, BRICK_HEIGHT);
          
          // Inner highlight
          ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
          ctx.fillRect(brick.x + 3, brick.y + 3, BRICK_WIDTH - 6, BRICK_HEIGHT - 6);
          
          // Center core
          ctx.fillStyle = 'white';
          ctx.fillRect(brick.x + 6, brick.y + 15, BRICK_WIDTH - 12, BRICK_HEIGHT - 30);
        }
      }

      // Draw Paddles
      ctx.shadowBlur = 15;
      
      // Player Paddle
      ctx.fillStyle = '#00f2ff'; // Neon Cyan for Player
      ctx.shadowColor = '#00f2ff';
      const playerPaddleHeightDraw = activePowerUps.player.big > 0 ? PADDLE_HEIGHT * 1.5 : PADDLE_HEIGHT;
      ctx.fillRect(0, playerY.current, PADDLE_WIDTH, playerPaddleHeightDraw);
      
      // AI Paddle
      ctx.fillStyle = '#ff007a'; // Neon Pink for AI
      ctx.shadowColor = '#ff007a';
      const aiPaddleHeightDraw = activePowerUps.ai.big > 0 ? PADDLE_HEIGHT * 1.5 : PADDLE_HEIGHT;
      ctx.fillRect(CANVAS_WIDTH - PADDLE_WIDTH, aiY.current, PADDLE_WIDTH, aiPaddleHeightDraw);

      // Draw Lasers
      for (const laser of lasers.current) {
        ctx.fillStyle = laser.owner === 'PLAYER' ? '#00f2ff' : '#ff007a';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 10;
        ctx.fillRect(laser.x, laser.y - 2, 20 * (laser.vx > 0 ? 1 : -1), 4);
      }

      // Draw Ball
      ctx.fillStyle = ballColor.current;
      ctx.shadowColor = ballColor.current;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(ballPos.current.x + BALL_SIZE / 2, ballPos.current.y + BALL_SIZE / 2, BALL_SIZE / 2, 0, Math.PI * 2);
      ctx.fill();

      // Reset shadow for next frame
      ctx.shadowBlur = 0;
    };

    const loop = () => {
      update();
      draw();
      animationFrameId = requestAnimationFrame(loop);
    };

    loop();

    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState]);

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center font-sans overflow-hidden">
      {/* Mute Toggle */}
      <div className="absolute top-8 right-8">
        <button 
          onClick={() => setIsMuted(!isMuted)}
          className="p-3 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors text-white/50 hover:text-white"
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
      </div>

      {/* Header / Scoreboard */}
      <div className="mb-8 flex items-center gap-12">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2 text-cyan-400 mb-1">
            {isAiMode ? <Cpu size={16} /> : <User size={16} />}
            <span className="text-xs uppercase tracking-widest font-bold">{isAiMode ? 'Bot 1' : 'Player'}</span>
          </div>
          <motion.span 
            key={playerScore}
            initial={{ scale: 1.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-6xl font-black font-mono text-cyan-400"
          >
            {playerScore}
          </motion.span>

          {/* Player Power-up Status */}
          <div className="mt-2 flex flex-col gap-1 items-center h-12">
            {activePowerUps.player.big > 0 && (
              <div className="flex items-center gap-2 text-green-400 font-mono text-[9px] uppercase font-bold">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Big: {(activePowerUps.player.big / 60).toFixed(1)}s
              </div>
            )}
            {activePowerUps.player.multiplier > 0 && (
              <div className="flex items-center gap-2 text-purple-400 font-mono text-[9px] uppercase font-bold">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                3x: {(activePowerUps.player.multiplier / 60).toFixed(1)}s
              </div>
            )}
            {activePowerUps.player.laser > 0 && (
              <div className="flex items-center gap-2 text-red-500 font-mono text-[9px] uppercase font-bold">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                Lasers: {(activePowerUps.player.laser / 60).toFixed(1)}s
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col items-center px-6 border-x border-white/10">
          <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/30 mb-1">Level</span>
          <motion.span 
            key={level}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-4xl font-black font-mono text-white"
          >
            {level}
          </motion.span>
          <span className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/30 mt-1">of 10</span>
          <span className="text-6xl font-black font-mono text-white mt-4 tracking-tighter italic uppercase">Ponganoid</span>
        </div>

        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2 text-pink-500 mb-1">
            <Cpu size={16} />
            <span className="text-xs uppercase tracking-widest font-bold">{isAiMode ? 'Bot 2' : 'AI Bot'}</span>
          </div>
          <motion.span 
            key={aiScore}
            initial={{ scale: 1.5, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-6xl font-black font-mono text-pink-500"
          >
            {aiScore}
          </motion.span>

          {/* AI Power-up Status */}
          <div className="mt-2 flex flex-col gap-1 items-center h-12">
            {activePowerUps.ai.big > 0 && (
              <div className="flex items-center gap-2 text-green-400 font-mono text-[9px] uppercase font-bold">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                Big: {(activePowerUps.ai.big / 60).toFixed(1)}s
              </div>
            )}
            {activePowerUps.ai.multiplier > 0 && (
              <div className="flex items-center gap-2 text-purple-400 font-mono text-[9px] uppercase font-bold">
                <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                3x: {(activePowerUps.ai.multiplier / 60).toFixed(1)}s
              </div>
            )}
            {activePowerUps.ai.laser > 0 && (
              <div className="flex items-center gap-2 text-red-500 font-mono text-[9px] uppercase font-bold">
                <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                Lasers: {(activePowerUps.ai.laser / 60).toFixed(1)}s
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Game Container */}
      <motion.div 
        className="relative group"
        animate={isShaking ? {
          x: [0, -10, 10, -10, 10, 0],
          y: [0, 5, -5, 5, -5, 0],
        } : {}}
        transition={{ duration: 0.15 }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="rounded-xl border border-white/10 shadow-2xl shadow-cyan-500/10 bg-black"
        />

        {/* Notifications */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none overflow-hidden">
          <AnimatePresence>
            {notifications.map((n) => (
              <motion.div
                key={n.id}
                initial={{ y: 50, opacity: 0, scale: 0.5 }}
                animate={{ y: 0, opacity: 1, scale: 1 }}
                exit={{ y: -100, opacity: 0, scale: 1.5 }}
                className="mb-2 px-8 py-3 rounded-full border-2 bg-black/80 backdrop-blur-md shadow-[0_0_30px_rgba(0,0,0,0.5)]"
                style={{ borderColor: `${n.color}66`, color: n.color, boxShadow: `0 0 20px ${n.color}33` }}
              >
                <span className="font-mono font-black text-2xl tracking-[0.2em] uppercase italic drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
                  {n.text}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {/* Overlays */}
        <AnimatePresence>
          {gameState === 'PLAYING' && isServing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div className="bg-black/40 backdrop-blur-[2px] px-6 py-3 rounded-full border border-white/10">
                <p className={`${currentServer === 'PLAYER' ? 'text-cyan-400' : 'text-pink-500'} font-mono text-xs uppercase tracking-[0.3em] font-bold animate-pulse`}>
                  {currentServer === 'PLAYER' ? 'Press any key to serve' : 'AI Bot is serving...'}
                </p>
              </div>
            </motion.div>
          )}

          {gameState === 'PLAYING' && isBallMagnetized.current && lastHitter.current === 'PLAYER' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
            >
              <div className="bg-orange-500/20 backdrop-blur-[2px] px-6 py-3 rounded-full border border-orange-500/30">
                <p className="text-orange-400 font-mono text-xs uppercase tracking-[0.3em] font-bold animate-pulse">
                  Press Space to Release Ball
                </p>
              </div>
            </motion.div>
          )}

          {gameState === 'START' && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm rounded-xl"
            >
              <h1 className="text-7xl font-black italic uppercase tracking-tighter mb-4 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-pink-500">
                Ponganoid
              </h1>
              <p className="text-white/60 mb-8 font-mono text-sm">USE W/S OR ARROW KEYS TO MOVE</p>
              <div className="flex flex-col gap-4">
                <button
                  onClick={() => startGame(false)}
                  className="group relative px-8 py-4 bg-white text-black font-bold uppercase tracking-widest rounded-full hover:scale-105 transition-transform flex items-center gap-3"
                >
                  <Play size={20} fill="currentColor" />
                  Start Game
                  <div className="absolute -inset-1 bg-gradient-to-r from-cyan-400 to-pink-500 rounded-full blur opacity-30 group-hover:opacity-60 transition-opacity" />
                </button>
                <button
                  onClick={() => startGame(true)}
                  className="group relative px-8 py-4 bg-white/10 text-white font-bold uppercase tracking-widest rounded-full hover:scale-105 transition-transform flex items-center gap-3 border border-white/20"
                >
                  <Cpu size={20} />
                  AI Mode
                  <div className="absolute -inset-1 bg-cyan-400 rounded-full blur opacity-0 group-hover:opacity-20 transition-opacity" />
                </button>
              </div>
              {isAiMode && (
                <p className="mt-4 text-white/40 font-mono text-[10px] uppercase tracking-widest">Press 'E' to exit AI Mode</p>
              )}
            </motion.div>
          )}

          {gameState === 'GAME_OVER' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 backdrop-blur-md rounded-xl"
            >
              <Trophy size={64} className={winner === 'PLAYER' ? 'text-cyan-400 mb-4' : 'text-pink-500 mb-4'} />
              <h2 className="text-5xl font-black uppercase italic mb-2">
                {winner === 'PLAYER' ? 'Victory!' : 'Defeat'}
              </h2>
              <p className="text-white/50 mb-8 font-mono">Final Score: {playerScore} - {aiScore}</p>
              <button
                onClick={startGame}
                className="px-8 py-4 border-2 border-white/20 hover:border-white hover:bg-white hover:text-black font-bold uppercase tracking-widest rounded-full transition-all flex items-center gap-3"
              >
                <RotateCcw size={20} />
                Play Again
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Footer Info */}
      <div className="mt-8 flex gap-8 text-[10px] uppercase tracking-[0.2em] font-bold text-white/30">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          Highest score in level 10 wins
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-pink-500 animate-pulse" />
          Bricks: +1 Point
        </div>
      </div>
    </div>
  );
}
