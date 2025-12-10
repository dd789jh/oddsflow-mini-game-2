import { useState, useRef, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { Volume2, VolumeX, Info, Trophy } from 'lucide-react'

// Telegram WebApp TypeScript declaration
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        expand: () => void
        ready: () => void
        [key: string]: any
      }
    }
  }
}

type Lang = 'en' | 'zh'
type GameState = 'BETTING' | 'LOCKED' | 'RESULT'
type BetType = 'home' | 'draw' | 'away'

// Team DNA Database
const TEAMS_DB = {
  'Real Madrid': {
    color: 'from-white to-yellow-400',
    abbr: 'RM',
  },
  'Man City': {
    color: 'from-sky-300 to-blue-500',
    abbr: 'MC',
  },
  'Man Utd': {
    color: 'from-red-600 to-red-900',
    abbr: 'MU',
  },
  'Liverpool': {
    color: 'from-red-500 to-red-700',
    abbr: 'LIV',
  },
  'Chelsea': {
    color: 'from-blue-600 to-blue-800',
    abbr: 'CHE',
  },
  'Bayern': {
    color: 'from-red-600 to-blue-800',
    abbr: 'BAY',
  },
  'PSG': {
    color: 'from-blue-800 to-red-600',
    abbr: 'PSG',
  },
  'Juventus': {
    color: 'from-gray-100 to-black',
    abbr: 'JUV',
  },
} as const

type TeamName = keyof typeof TEAMS_DB

const TEAM_POOL: TeamName[] = [
  'Real Madrid',
  'Man City',
  'Man Utd',
  'Liverpool',
  'Chelsea',
  'Bayern',
  'PSG',
  'Juventus',
]

type FormResult = 'W' | 'D' | 'L'

interface Match {
  home: TeamName
  away: TeamName
  homeForm: FormResult[]
  awayForm: FormResult[]
  odds: {
    home: number
    draw: number
    away: number
  }
  oddsTrend: {
    home: 'up' | 'down' | null
    draw: 'up' | 'down' | null
    away: 'up' | 'down' | null
  }
}

interface UserBet {
  type: BetType | null
  amount: number
}

const translations = {
  en: {
    cyber_cup: 'CYBER CUP',
    neon_football_bet: 'Neon Football Bet',
    lives: 'Lives',
    place_bet: 'PLACE BET',
    vs: 'VS',
    total_goals: 'Total Goals',
    team: 'Team',
    goals: 'Goals',
    full_time: 'Full Time',
    vip_ai_prediction: 'VIP AI Prediction',
    win_rate: '85% Win Rate · Tap to unlock',
    ai_locked: 'AI Locked',
    out_of_energy: 'OUT OF ENERGY ⚡️',
    invite_friend: 'Invite 1 friend to revive instantly!',
    share_to_revive: 'Share to Revive',
    unlock_vip: 'UNLOCK VIP 🔓',
    join_channel: 'Join our Telegram Channel to see the winner!',
    join_channel_btn: 'Join Channel',
    how_to_play: 'How to Play',
    step1_title: '⏱️ Fast Market',
    step1_desc: 'You have **20 seconds** to pick Home, Draw, or Away. Watch the Odds!',
    step2_title: '🔥 Smash to Boost',
    step2_desc: 'During the match, **tap the FIRE button** fast to boost your team\'s energy!',
    step3_title: '💰 Win Big',
    step3_desc: 'Guess right? You win **Bet Amount x Odds**. (e.g., 100 x 2.5 = 250 Coins).',
    step4_title: '⛏️ Mine Coins',
    step4_desc: 'Out of Coins? **Invite a friend** to get +500 Coins & +2 Lives instantly.',
    got_it: 'I\'m Ready to Win! 🚀',
    top_winners: 'Top Winners',
    wins: 'Wins',
    streak: 'Streak',
    you_bet: 'You bet',
    on: 'on',
    home_win: 'Home Win',
    draw: 'Draw',
    away_win: 'Away Win',
    coins: 'Coins',
    lost: 'Lost...',
    try_again: 'Try again!',
  },
  zh: {
    cyber_cup: '赛博杯',
    neon_football_bet: '霓虹足球竞猜',
    lives: '体力',
    place_bet: '确认下注',
    vs: '对战',
    total_goals: '总进球',
    team: '球队',
    goals: '进球',
    full_time: '全场',
    vip_ai_prediction: 'VIP AI 预测',
    win_rate: '85% 胜率 · 点击解锁',
    ai_locked: 'AI 已锁定',
    out_of_energy: '体力耗尽 ⚡️',
    invite_friend: '邀请 1 位好友即可立即恢复！',
    share_to_revive: '分享恢复',
    unlock_vip: '解锁 VIP 🔓',
    join_channel: '加入我们的 Telegram 频道查看获胜者！',
    join_channel_btn: '加入频道',
    how_to_play: '游戏规则',
    step1_title: '⏱️ 极速盘口',
    step1_desc: '你有 **20 秒** 选择主胜、平局或客胜。关注赔率！',
    step2_title: '🔥 疯狂应援',
    step2_desc: '比赛进行时，**快速点击火焰按钮**为你的队伍加油！',
    step3_title: '💰 赢取金币',
    step3_desc: '猜对了？你将获得 **下注金额 x 赔率**。（例如：100 x 2.5 = 250 金币）。',
    step4_title: '⛏️ 拉人挖矿',
    step4_desc: '金币不足？**邀请好友**立即获得 +500 金币和 +2 体力。',
    got_it: '我准备好了！🚀',
    top_winners: '排行榜',
    wins: '胜场',
    streak: '连胜',
    you_bet: '您下注',
    on: '于',
    home_win: '主胜',
    draw: '平局',
    away_win: '客胜',
    coins: '金币',
    lost: '未中...',
    try_again: '再试一次！',
  },
} as const

const Modal = ({
  show,
  onClose,
  title,
  description,
  actionLabel,
  actionColor,
}: {
  show: boolean
  onClose: () => void
  title: string
  description: string
  actionLabel: string
  actionColor: 'blue' | 'green'
}) => (
  <AnimatePresence>
    {show && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="relative w-[90%] max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-[0_0_30px_rgba(59,130,246,0.4)]"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
          <div className="relative space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 shadow-[0_0_25px_rgba(99,102,241,0.7)]" />
              <div>
                <p className="text-lg font-bold text-white">{title}</p>
                <p className="text-sm text-slate-300">{description}</p>
              </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onClose}
              className={`w-full rounded-2xl px-4 py-3 text-base font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)] ${
                actionColor === 'green'
                  ? 'bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-600'
                  : 'bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600'
              }`}
            >
              {actionLabel}
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
)

const RulesModal = ({
  show,
  onClose,
  t,
}: {
  show: boolean
  onClose: () => void
  t: typeof translations.en | typeof translations.zh
}) => (
  <AnimatePresence>
    {show && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
          className="relative w-[90%] max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-[0_0_30px_rgba(59,130,246,0.4)] backdrop-blur-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
          <div className="relative space-y-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 shadow-[0_0_25px_rgba(99,102,241,0.7)]" />
              <p className="text-3xl font-bold text-white">{t.how_to_play}</p>
            </div>
            
            {/* Step 1: Fast Market */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <div className="flex items-start gap-3">
                <div className="text-2xl shrink-0">⏱️</div>
                <div className="flex-1">
                  <p className="text-lg font-bold text-cyan-400 mb-1">{t.step1_title}</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {t.step1_desc.split('**').map((part, i) => 
                      i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Step 2: Smash to Boost */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <div className="flex items-start gap-3">
                <div className="text-2xl shrink-0">🔥</div>
                <div className="flex-1">
                  <p className="text-lg font-bold text-red-400 mb-1">{t.step2_title}</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {t.step2_desc.split('**').map((part, i) => 
                      i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Step 3: Win Big */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <div className="flex items-start gap-3">
                <div className="text-2xl shrink-0">💰</div>
                <div className="flex-1">
                  <p className="text-lg font-bold text-amber-400 mb-1">{t.step3_title}</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {t.step3_desc.split('**').map((part, i) => 
                      i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Step 4: Mine Coins */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <div className="flex items-start gap-3">
                <div className="text-2xl shrink-0">⛏️</div>
                <div className="flex-1">
                  <p className="text-lg font-bold text-green-400 mb-1">{t.step4_title}</p>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {t.step4_desc.split('**').map((part, i) => 
                      i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
                    )}
                  </p>
                </div>
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onClose}
              className="w-full rounded-2xl bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600 px-4 py-3 text-xl font-bold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)] active:scale-95 transition-all"
            >
              {t.got_it}
            </motion.button>
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
)

const LeaderboardModal = ({
  show,
  onClose,
  t,
}: {
  show: boolean
  onClose: () => void
  t: typeof translations.en | typeof translations.zh
}) => {
  const leaders = [
    { rank: 1, name: 'Alex_Crypto', wins: 12, medal: '🥇', color: 'from-yellow-400 to-amber-500' },
    { rank: 2, name: 'BetKing99', wins: 10, medal: '🥈', color: 'from-slate-300 to-slate-400' },
    { rank: 3, name: 'Sarah_J', wins: 8, medal: '🥉', color: 'from-amber-600 to-amber-700' },
    { rank: 4, name: 'User_888', wins: 5, medal: '', color: '' },
    { rank: 5, name: 'Tom.eth', wins: 4, medal: '', color: '' },
  ]

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative w-[90%] max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-6 shadow-[0_0_30px_rgba(59,130,246,0.4)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
            <div className="relative space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 shadow-[0_0_25px_rgba(251,191,36,0.7)]" />
                <p className="text-3xl font-bold text-white">{t.top_winners}</p>
              </div>
              <div className="space-y-3">
                {leaders.map((leader) => (
                  <div
                    key={leader.rank}
                    className={`flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4 ${
                      leader.rank <= 3
                        ? `bg-gradient-to-r ${leader.color} text-white shadow-[0_0_20px_rgba(251,191,36,0.4)]`
                        : 'text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{leader.medal}</span>
                      <span className="text-lg font-bold">{leader.name}</span>
                    </div>
                    <div className="text-lg font-semibold">
                      {leader.wins} {t.wins}
                    </div>
                  </div>
                ))}
              </div>
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={onClose}
                className="w-full rounded-2xl bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600 px-4 py-3 text-xl font-bold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]"
              >
                {t.got_it}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Live Commentary Widget with Audio Triggers
const LiveCommentary = ({ 
  text, 
  isMuted,
  goalRef,
  crowdGaspRef,
}: { 
  text: string
  isMuted: boolean
  goalRef: React.RefObject<HTMLAudioElement | null>
  crowdGaspRef: React.RefObject<HTMLAudioElement | null>
}) => {
  // Audio trigger logic with debugging
  useEffect(() => {
    if (!text || isMuted) return

    const upperText = text.toUpperCase()
    
    // Check for GOAL
    if (upperText.includes('GOAL')) {
      console.log('Attempting to play GOAL audio...')
      if (goalRef.current) {
        goalRef.current.currentTime = 0
        goalRef.current.play()
          .then(() => {
            console.log('GOAL audio played successfully')
          })
          .catch((e) => {
            console.error('Audio play failed (GOAL):', e)
            console.error('File path: /voice_goal.mp3')
          })
      } else {
        console.error('goalRef.current is null')
      }
    }
    // Check for danger/shot/miss
    else if (
      upperText.includes('DANGER') ||
      upperText.includes('SHOT') ||
      upperText.includes('MISS')
    ) {
      console.log('Attempting to play crowd gasp audio...')
      if (crowdGaspRef.current) {
        crowdGaspRef.current.currentTime = 0
        crowdGaspRef.current.play()
          .then(() => {
            console.log('Crowd gasp audio played successfully')
          })
          .catch((e) => {
            console.error('Audio play failed (crowd gasp):', e)
            console.error('File path: /crowd_gasp.mp3')
          })
      } else {
        console.error('crowdGaspRef.current is null')
      }
    }
  }, [text, isMuted, goalRef, crowdGaspRef])

  if (!text) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-yellow-400/30 bg-black/80 px-4 py-2 backdrop-blur-md shadow-[0_0_20px_rgba(251,191,36,0.3)]"
    >
      <div className="flex items-center gap-2">
        <span className="text-yellow-400 animate-pulse">🔴 LIVE</span>
        <span className="text-yellow-300 font-semibold text-sm md:text-base">{text}</span>
      </div>
    </motion.div>
  )
}

// Team Avatar Component (Gradient background + Abbreviation)
const TeamAvatar = ({ teamName }: { teamName: TeamName }) => {
  const team = TEAMS_DB[teamName]
  const colorClass = team.color

  return (
    <div className={`h-16 w-16 rounded-full bg-gradient-to-br ${colorClass} flex items-center justify-center shadow-lg border-2 border-white/20`}>
      <span className="text-white font-black text-lg drop-shadow-md">{team.abbr}</span>
    </div>
  )
}

// Recent Form Component
const RecentForm = ({ form }: { form: FormResult[] }) => {
  return (
    <div className="flex items-center gap-1.5">
      {form.map((result, index) => (
        <div
          key={index}
          className={`h-2.5 w-2.5 rounded-full ${
            result === 'W'
              ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
              : result === 'D'
              ? 'bg-gray-400 shadow-[0_0_8px_rgba(156,163,175,0.4)]'
              : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
          }`}
        />
      ))}
    </div>
  )
}

// Immersive Holographic Stadium Component with Layered Layout
const HolographicStadium = ({
  gameState,
  matchResult,
  currentMatch,
  commentary,
  isMuted,
  goalRef,
  crowdGaspRef,
  liveScore,
}: {
  gameState: GameState
  matchResult: { home: number; away: number } | null
  currentMatch: Match
  commentary: string
  isMuted: boolean
  goalRef: React.RefObject<HTMLAudioElement | null>
  crowdGaspRef: React.RefObject<HTMLAudioElement | null>
  liveScore: { home: number; away: number }
}) => {
  return (
    <div className="relative h-80 w-full overflow-hidden rounded-2xl">
      {/* Layer 1: Background - Holographic Pitch (Z-Index 0) */}
      <div className="absolute inset-0 z-0 border-2 border-cyan-400/60 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-black shadow-[0_0_40px_rgba(6,182,212,0.4)]">
        {/* Grid Texture Overlay */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(6,182,212,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.05)_1px,transparent_1px)] bg-[size:20px_20px]" />
        
        {/* Center Line (Vertical) */}
        <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 border-l border-cyan-400/60 drop-shadow-[0_0_15px_rgba(6,182,212,0.9)]" />
        
        {/* Center Circle */}
        <motion.div
          className={`absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan-400/60 drop-shadow-[0_0_20px_rgba(6,182,212,0.9)] ${
            gameState === 'LOCKED' ? 'animate-pulse' : ''
          }`}
          animate={gameState === 'LOCKED' ? {
            boxShadow: [
              '0_0_20px_rgba(6,182,212,0.9)',
              '0_0_30px_rgba(6,182,212,1)',
              '0_0_20px_rgba(6,182,212,0.9)',
            ],
          } : {}}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
        
        {/* Center Point */}
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400 shadow-[0_0_15px_rgba(6,182,212,1)]" />
        
        {/* Left Penalty Area */}
        <div className="absolute left-0 top-1/2 h-32 w-24 -translate-y-1/2 rounded-r-3xl border-2 border-r border-cyan-400/60 drop-shadow-[0_0_15px_rgba(6,182,212,0.8)]" />
        <div className="absolute left-0 top-1/2 h-16 w-12 -translate-y-1/2 rounded-r-2xl border-2 border-r border-cyan-400/60 drop-shadow-[0_0_15px_rgba(6,182,212,0.8)]" />
        
        {/* Right Penalty Area */}
        <div className="absolute right-0 top-1/2 h-32 w-24 -translate-y-1/2 rounded-l-3xl border-2 border-l border-cyan-400/60 drop-shadow-[0_0_15px_rgba(6,182,212,0.8)]" />
        <div className="absolute right-0 top-1/2 h-16 w-12 -translate-y-1/2 rounded-l-2xl border-2 border-l border-cyan-400/60 drop-shadow-[0_0_15px_rgba(6,182,212,0.8)]" />
        
        {/* Corner Arcs */}
        <div className="absolute left-0 top-0 h-8 w-8 rounded-br-full border-b-2 border-r-2 border-cyan-400/60 drop-shadow-[0_0_12px_rgba(6,182,212,0.8)]" />
        <div className="absolute left-0 bottom-0 h-8 w-8 rounded-tr-full border-t-2 border-r-2 border-cyan-400/60 drop-shadow-[0_0_12px_rgba(6,182,212,0.8)]" />
        <div className="absolute right-0 top-0 h-8 w-8 rounded-bl-full border-b-2 border-l-2 border-cyan-400/60 drop-shadow-[0_0_12px_rgba(6,182,212,0.8)]" />
        <div className="absolute right-0 bottom-0 h-8 w-8 rounded-tl-full border-t-2 border-l-2 border-cyan-400/60 drop-shadow-[0_0_12px_rgba(6,182,212,0.8)]" />
      </div>

      {/* Layer 2: Data Panel (Z-Index 10) */}
      <div className="absolute inset-0 z-10 flex items-center bg-gradient-to-t from-slate-900/90 via-slate-900/40 to-transparent backdrop-blur-[2px]">
        <div className="grid w-full grid-cols-[1.2fr_auto_1.2fr] gap-4 px-6">
          {/* Left: Home Team Info */}
          <div className="flex flex-col items-center justify-center text-center">
            <TeamAvatar teamName={currentMatch.home} />
            <div className="mt-3 relative">
              {/* Ambient Glow */}
              <div 
                className={`absolute inset-0 blur-2xl opacity-30 -z-10 bg-gradient-to-r ${TEAMS_DB[currentMatch.home].color}`}
                style={{ transform: 'scale(2)' }}
              />
              <p className="text-xl font-bold text-white relative z-0 drop-shadow-[0_0_8px_rgba(0,0,0,0.8)]">
                {currentMatch.home}
              </p>
            </div>
            <div className="mt-2">
              <RecentForm form={currentMatch.homeForm} />
            </div>
          </div>

          {/* Center: Match Status & Commentary */}
          <div className="flex flex-col items-center justify-center gap-3">
            {/* Live Commentary - Floating at top */}
            {gameState === 'LOCKED' && commentary && (
              <AnimatePresence mode="wait">
                <LiveCommentary
                  key={commentary}
                  text={commentary}
                  isMuted={isMuted}
                  goalRef={goalRef}
                  crowdGaspRef={crowdGaspRef}
                />
              </AnimatePresence>
            )}
            
            {/* Match Status Display */}
            {gameState === 'BETTING' && (
              <motion.div
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-center"
              >
                <p className="text-3xl font-bold text-cyan-300 drop-shadow-[0_0_15px_rgba(6,182,212,0.8)]">
                  VS
                </p>
              </motion.div>
            )}
            {gameState === 'LOCKED' && (
              <div className="text-center">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
                  className="mb-2 inline-block"
                >
                  <div className="h-12 w-12 rounded-full border-2 border-cyan-400 border-t-transparent" />
                </motion.div>
                <p className="text-2xl font-bold text-red-400 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-pulse">
                  LIVE
                </p>
              </div>
            )}
            {gameState === 'LOCKED' && (
              <motion.div
                key={`${liveScore.home}-${liveScore.away}`}
                initial={{ scale: 1.2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center"
              >
                <p className="text-5xl font-black text-white drop-shadow-[0_0_20px_rgba(251,191,36,0.8)]">
                  {liveScore.home} - {liveScore.away}
                </p>
              </motion.div>
            )}
            {gameState === 'RESULT' && matchResult && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center"
              >
                <p className="text-5xl font-black text-white drop-shadow-[0_0_20px_rgba(251,191,36,0.8)]">
                  {matchResult.home} - {matchResult.away}
                </p>
              </motion.div>
            )}
          </div>

          {/* Right: Away Team Info */}
          <div className="flex flex-col items-center justify-center text-center">
            <TeamAvatar teamName={currentMatch.away} />
            <div className="mt-3 relative">
              {/* Ambient Glow */}
              <div 
                className={`absolute inset-0 blur-2xl opacity-30 -z-10 bg-gradient-to-r ${TEAMS_DB[currentMatch.away].color}`}
                style={{ transform: 'scale(2)' }}
              />
              <p className="text-xl font-bold text-white relative z-0 drop-shadow-[0_0_8px_rgba(0,0,0,0.8)]">
                {currentMatch.away}
              </p>
            </div>
            <div className="mt-2">
              <RecentForm form={currentMatch.awayForm} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Share Slip Modal
const ShareSlipModal = ({
  show,
  onClose,
}: {
  show: boolean
  onClose: () => void
}) => {
  // Randomly choose between two revolutionary share messages
  const shareMessages = [
    `I'm gathering a team to beat the Banker on OddsFlow! We use AI, not luck. 🚀 Join my squad!`,
    `Stop donating to the bookies. Come look at the data with us. 📊 #OddsFlowRevolution`,
  ]
  const shareText = shareMessages[Math.floor(Math.random() * shareMessages.length)]

  const handleCopy = () => {
    navigator.clipboard.writeText(shareText)
    // You can add a toast notification here
  }

  const handleTelegramShare = () => {
    // If Telegram WebApp is available
    if ((window as any).Telegram?.WebApp) {
      (window as any).Telegram.WebApp.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(shareText)}`)
    } else {
      // Fallback: copy to clipboard
      handleCopy()
    }
    onClose()
  }

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative w-[90%] max-w-md rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-[0_0_30px_rgba(59,130,246,0.4)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
            <div className="relative space-y-4">
              <div className="flex items-center gap-3">
                <div className="h-12 w-12 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_25px_rgba(59,130,246,0.7)] flex items-center justify-center text-2xl">
                  ✈️
                </div>
      <div>
                  <p className="text-xl font-bold text-white">Share Your Bet</p>
                  <p className="text-sm text-slate-300">Challenge your friends!</p>
      </div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <p className="text-sm text-slate-300 leading-relaxed">{shareText}</p>
              </div>
              <div className="flex gap-3">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={handleCopy}
                  className="flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-base font-semibold text-white hover:bg-white/20 transition"
                >
                  Copy Text
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={handleTelegramShare}
                  className="flex-1 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-4 py-3 text-base font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]"
                >
                  Share on Telegram
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Win/Loss Streak Effect
const StreakEffect = ({ type }: { type: 'fire' | 'ice' }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={`fixed inset-0 z-50 pointer-events-none flex items-center justify-center ${
        type === 'fire' ? 'bg-red-500/20' : 'bg-blue-500/20'
      }`}
    >
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        className="text-center"
      >
        <motion.h1
          className={`text-6xl md:text-8xl font-black ${
            type === 'fire'
              ? 'text-red-500 drop-shadow-[0_0_30px_rgba(239,68,68,0.8)]'
              : 'text-blue-400 drop-shadow-[0_0_30px_rgba(59,130,246,0.8)]'
          }`}
          animate={{
            scale: [1, 1.1, 1],
          }}
          transition={{
            duration: 1,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        >
          {type === 'fire' ? 'ON FIRE! 🔥' : 'ICE COLD ❄️'}
        </motion.h1>
        {type === 'ice' && (
          <p className="text-xl text-slate-300 mt-4 font-semibold">Needs Analysis?</p>
        )}
      </motion.div>
    </motion.div>
  )
}

// Floating Text Animation Component
const FloatingText = ({ text, x, y }: { text: string; x: number; y: number }) => {
  return (
    <motion.div
      initial={{ opacity: 1, y: 0, scale: 1 }}
      animate={{ opacity: 0, y: -50, scale: 1.2 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 2, ease: 'easeOut' }}
      className="fixed pointer-events-none z-50"
      style={{ left: x, top: y, transform: 'translate(-50%, -50%)' }}
    >
      <p className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-400 to-yellow-500 drop-shadow-[0_0_10px_rgba(251,191,36,0.8)]">
        {text}
      </p>
    </motion.div>
  )
}

// Smash to Boost Component - High-frequency interaction during match
const SmashToBoost = ({
  onSmash,
  fanEnergy,
  isMuted,
}: {
  onSmash: () => void
  fanEnergy: number
  isMuted: boolean
}) => {
  const [particles, setParticles] = useState<Array<{ id: number; emoji: string; x: number; y: number }>>([])
  
  const handleSmash = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Haptic feedback - stronger vibration for more impact
    if (navigator.vibrate) {
      navigator.vibrate([40, 20, 40])
    }
    
    // Play click sound - louder and faster
    if (!isMuted) {
      const audio = new Audio('/click.wav')
      audio.volume = 0.5
      audio.playbackRate = 1.2
      audio.play().catch(() => {})
    }
    
    // Calculate precise origin point (button center)
    const rect = e.currentTarget.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const originX = centerX / window.innerWidth
    const originY = centerY / window.innerHeight
    
    // Enhanced particle system for additional visual layer
    const emojis = ['🔥', '⚽', '❤️', '🚀', '💥']
    const newParticles = Array.from({ length: 10 }, (_, i) => ({
      id: Date.now() + i,
      emoji: emojis[Math.floor(Math.random() * emojis.length)],
      x: centerX + (Math.random() - 0.5) * 200,
      y: centerY + (Math.random() - 0.5) * 200,
    }))
    
    setParticles((prev) => [...prev, ...newParticles])
    
    // Remove particles after animation
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => !newParticles.includes(p)))
    }, 2500)
    
    // MASSIVE VISUAL BOMBARDMENT - Primary confetti burst
    confetti({
      particleCount: 40,
      spread: 120,
      angle: 90,
      startVelocity: 55,
      decay: 0.92,
      ticks: 150,
      scalar: 2.5,
      origin: { x: originX, y: originY },
      shapes: ['emoji'],
      shapeOptions: {
        emoji: {
          value: ['🔥', '❤️', '⚽', '🚀', '💥'],
        },
      },
    })
    
    // Secondary burst - slightly delayed for layered effect
    setTimeout(() => {
      confetti({
        particleCount: 25,
        spread: 100,
        angle: 85,
        startVelocity: 50,
        decay: 0.9,
        ticks: 120,
        scalar: 2.0,
        origin: { x: originX, y: originY },
        shapes: ['emoji'],
        shapeOptions: {
          emoji: {
            value: ['🔥', '❤️', '⚽', '💪', '🎯'],
          },
        },
      })
    }, 50)
    
    // Tertiary burst - wide horizontal spread
    setTimeout(() => {
      confetti({
        particleCount: 20,
        spread: 140,
        angle: 90,
        startVelocity: 45,
        decay: 0.88,
        ticks: 130,
        scalar: 2.2,
        origin: { x: originX, y: originY },
        shapes: ['emoji'],
        shapeOptions: {
          emoji: {
            value: ['🔥', '⚽', '🚀', '💥', '❤️'],
          },
        },
      })
    }, 100)
    
    onSmash()
  }
  
  return (
    <div className="relative">
      {/* Fan Energy Counter */}
      <div className="mb-3 text-center">
        <p className="text-xs text-slate-400 mb-1">FAN ENERGY</p>
        <motion.p
          key={fanEnergy}
          initial={{ scale: 1.2 }}
          animate={{ scale: 1 }}
          className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-red-400 via-orange-400 to-red-500"
        >
          {fanEnergy.toLocaleString()}
        </motion.p>
      </div>
      
      {/* Smash Button */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={handleSmash}
        className="relative w-full h-32 rounded-full bg-gradient-to-br from-red-500 via-red-600 to-red-700 shadow-[0_0_40px_rgba(239,68,68,0.6)] border-4 border-red-400/50 active:scale-95 active:shadow-[0_0_30px_rgba(239,68,68,0.4)] transition-all"
      >
        <motion.div
          animate={{
            boxShadow: [
              '0_0_40px_rgba(239,68,68,0.6)',
              '0_0_60px_rgba(239,68,68,0.8)',
              '0_0_40px_rgba(239,68,68,0.6)',
            ],
          }}
          transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full"
        />
        <span className="relative z-10 text-4xl font-black text-white drop-shadow-[0_0_20px_rgba(0,0,0,0.8)]">
          🔥 SMASH!
        </span>
      </motion.button>
      
      {/* Particle Effects */}
      <AnimatePresence>
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            initial={{ opacity: 1, scale: 1, x: particle.x, y: particle.y }}
            animate={{ opacity: 0, scale: 1.5, y: particle.y - 100, x: particle.x + (Math.random() - 0.5) * 50 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 2, ease: 'easeOut' }}
            className="fixed pointer-events-none z-50 text-3xl"
            style={{ transform: 'translate(-50%, -50%)' }}
          >
            {particle.emoji}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

// Result Analysis Modal with AI Comparison - Uses Result Snapshot
const ResultAnalysisModal = ({
  show,
  onClose,
  roundResult,
  currentMatch,
  onClaim,
  winRef,
  isMuted,
}: {
  show: boolean
  onClose: () => void
  roundResult: { isWin: boolean; profit: number; result: string; userPick: string; matchScore: string } | null
  currentMatch: Match
  onClaim?: () => void
  winRef?: React.RefObject<HTMLAudioElement>
  isMuted?: boolean
}) => {
  // Only render if we have a result snapshot
  if (!roundResult) {
    return null
  }

  const { isWin, profit, result } = roundResult

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative w-[90%] max-w-md rounded-3xl border border-white/10 bg-slate-900/90 p-6 shadow-[0_0_30px_rgba(59,130,246,0.4)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -inset-px rounded-3xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
            <div className="relative space-y-4">
              {/* Main Result */}
              <div className="text-center">
                <div className="text-4xl mb-2">{isWin ? '🎉' : '😢'}</div>
                <p className={`text-2xl font-bold ${isWin ? 'text-amber-400' : 'text-red-400'}`}>
                  {isWin ? 'YOU WON!' : 'YOU LOST'}
                </p>
                {isWin && (
                  <p className="text-xl text-amber-300 mt-2 font-semibold">
                    +{profit.toLocaleString()} Coins 🪙
                  </p>
                )}
              </div>

              {/* AI Analysis Box - Only show on loss (Aggressive AI Mode) */}
              {!isWin && (
                <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-red-400">🤖</span>
                    <p className="text-sm font-semibold text-red-300">AI Analysis</p>
                  </div>
                  <p className="text-xs text-slate-400">
                    AI Model predicted: {result === 'HOME' ? currentMatch.home : result === 'DRAW' ? 'Draw' : currentMatch.away}
                  </p>
                  {(() => {
                    const messages = [
                      "The Banker loves your donation. 🤡",
                      "Betting with feelings? Rookie mistake.",
                      "Data saw this coming. You didn't.",
                    ]
                    return (
                      <p className="text-sm text-red-300 font-semibold">
                        {messages[Math.floor(Math.random() * messages.length)]}
                      </p>
                    )
                  })()}
                </div>
              )}
              
              {/* Win Message - Aggressive Victory Mode */}
              {isWin && (
                <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-green-400">💰</span>
                    <p className="text-sm font-semibold text-green-300">Victory Analysis</p>
                  </div>
                  {(() => {
                    const messages = [
                      "You robbed the Banker! 💰",
                      "Systems Analysis: CORRECT. Good execution.",
                      "Smart Money Move. Keep stacking.",
                    ]
                    return (
                      <p className="text-sm text-green-300 font-semibold">
                        {messages[Math.floor(Math.random() * messages.length)]}
                      </p>
                    )
                  })()}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3">
                {isWin ? (
                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={() => {
                      // Manual claim - trigger coin rain and effects
                      if (winRef && winRef.current && isMuted === false) {
                        winRef.current.currentTime = 0
                        winRef.current.play().catch(() => {})
                      }
                      
                      // Coin rain animation
                      confetti({
                        particleCount: 100,
                        spread: 70,
                        origin: { y: 0.3 },
                        colors: ['#FFD700', '#FFA500', '#FF8C00'],
                        shapes: ['circle'],
                      })
                      setTimeout(() => {
                        confetti({
                          particleCount: 100,
                          spread: 70,
                          origin: { y: 0.7 },
                          colors: ['#FFD700', '#FFA500', '#FF8C00'],
                          shapes: ['circle'],
                        })
                      }, 200)
                      
                      // Trigger wallet icon animation via callback
                      if (onClaim) {
                        onClaim()
                      }
                      
                      // Close modal after animation
                      setTimeout(() => {
                        onClose()
                      }, 500)
                    }}
                    className="w-full rounded-2xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 px-4 py-3 text-2xl font-black text-white shadow-[0_0_30px_rgba(251,191,36,0.6)] active:scale-95 active:shadow-[0_0_20px_rgba(251,191,36,0.4)] transition-all"
                  >
                    💰 CLAIM {profit.toLocaleString()} COINS
                  </motion.button>
                ) : (
                  <>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={onClose}
                      className="flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-base font-semibold text-white hover:bg-white/20 transition"
                    >
                      Close
                    </motion.button>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={() => {
                        // Navigate to real market (you can implement actual navigation here)
                        window.open('https://t.me/your_channel', '_blank')
                        onClose()
                      }}
                      className="flex-1 rounded-2xl bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-4 py-3 text-base font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]"
                    >
                      Go to Real Market 🚀
                    </motion.button>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// The Truth Modal (Community Values)
const TruthModal = ({
  show,
  onClose,
  message,
  lang,
}: {
  show: boolean
  onClose: () => void
  message: { en: string; zh: string }
  lang: Lang
}) => {
  const [displayedText, setDisplayedText] = useState('')
  const [isTyping, setIsTyping] = useState(true)

  useEffect(() => {
    if (!show) {
      setDisplayedText('')
      setIsTyping(true)
      return
    }

    const text = lang === 'en' ? message.en : message.zh
    let currentIndex = 0
    setDisplayedText('')

    const typeInterval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1))
        currentIndex++
      } else {
        setIsTyping(false)
        clearInterval(typeInterval)
      }
    }, 30) // Typing speed

    return () => clearInterval(typeInterval)
  }, [show, message, lang])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="relative w-[90%] max-w-2xl p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="space-y-8 text-center">
              <motion.p
                className="text-2xl md:text-3xl font-bold text-white leading-relaxed"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                {displayedText}
                {isTyping && (
                  <motion.span
                    animate={{ opacity: [1, 0] }}
                    transition={{ duration: 0.8, repeat: Infinity }}
                    className="ml-1"
                  >
                    |
                  </motion.span>
                )}
              </motion.p>
              {!isTyping && (
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => {
                    window.open('https://t.me/your_channel', '_blank')
                    onClose()
                  }}
                  className="mx-auto rounded-xl border-2 border-white bg-transparent px-8 py-4 text-lg font-bold text-white transition hover:bg-white hover:text-black"
                >
                  Join the Revolution ✊
                </motion.button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Splash Screen Component
const SplashScreen = ({ show }: { show: boolean }) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black"
        >
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <motion.h1
              className="text-3xl md:text-5xl font-black text-white tracking-wider"
              initial={{ letterSpacing: '0.1em' }}
              animate={{ letterSpacing: '0.2em' }}
              transition={{ duration: 0.5 }}
            >
              WE ARE HERE TO BREAK THE BANK.
            </motion.h1>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Tap to Start Audio Unlock Overlay
const TapToStartOverlay = ({ 
  show, 
  onTap 
}: { 
  show: boolean
  onTap: () => void 
}) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/80 backdrop-blur-md cursor-pointer"
          onClick={onTap}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="text-center"
          >
            <motion.div
              className="inline-block bg-cyan-500/20 border-2 border-cyan-400 px-8 py-4 rounded-full shadow-[0_0_20px_rgba(6,182,212,0.5)]"
              animate={{ 
                opacity: [0.7, 1, 0.7],
                scale: [1, 1.05, 1],
                boxShadow: [
                  '0_0_20px_rgba(6,182,212,0.5)',
                  '0_0_30px_rgba(6,182,212,0.8)',
                  '0_0_20px_rgba(6,182,212,0.5)',
                ]
              }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            >
              <p className="text-2xl md:text-3xl font-bold text-white mb-2">
                TAP ANYWHERE TO START GAME 🔊
              </p>
              <p className="text-sm text-cyan-300/80">Click to unlock audio</p>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// Generate random usernames
const generateUsername = () => {
  const prefixes = ['Crypto', 'Bet', 'Pro', 'Elite', 'Neon', 'Cyber', 'Apex', 'Alpha', 'Beta', 'Omega']
  const suffixes = ['Master', 'King', 'Queen', 'Lord', 'Duke', 'Warrior', 'Ninja', 'Ghost', 'Shadow', 'Phoenix']
  const numbers = Math.floor(Math.random() * 9999)
  const usePrefix = Math.random() > 0.5
  const useSuffix = Math.random() > 0.5
  
  if (usePrefix && useSuffix) {
    return `${prefixes[Math.floor(Math.random() * prefixes.length)]}_${suffixes[Math.floor(Math.random() * suffixes.length)]}${numbers}`
  } else if (usePrefix) {
    return `${prefixes[Math.floor(Math.random() * prefixes.length)]}_${numbers}`
  } else if (useSuffix) {
    return `User_${suffixes[Math.floor(Math.random() * suffixes.length)]}${numbers}`
  } else {
    return `User_${numbers}`
  }
}

// Generate activity data
const generateActivity = (id: number) => {
  const username = generateUsername()
  const type = Math.floor(Math.random() * 5)
  
  switch (type) {
    case 0: // Type A: Won coins from bet
      const coins = Math.floor(Math.random() * 500) + 100
      return {
        id,
        username,
        type: 'coins',
        coins,
        text: `just won`,
        suffix: `Coins from bet! 💰`,
        highlight: coins.toString(),
        highlightColor: 'text-amber-400',
      }
    case 1: // Type B: Earned coins from invite
      const inviteCoins = 500
      return {
        id,
        username,
        type: 'invite',
        coins: inviteCoins,
        text: `earned`,
        suffix: `Coins from invite! 🪙`,
        highlight: inviteCoins.toString(),
        highlightColor: 'text-amber-400',
      }
    case 2: // Type C: Spent coins to unlock signal
      const spentCoins = 500
      return {
        id,
        username,
        type: 'spent',
        coins: spentCoins,
        text: `spent`,
        suffix: `Coins to unlock Signal! 🔓`,
        highlight: spentCoins.toString(),
        highlightColor: 'text-amber-400',
      }
    case 3: // Type D: Win streak
      const streak = Math.floor(Math.random() * 8) + 3
      return {
        id,
        username,
        type: 'streak',
        streak,
        text: `hit a`,
        suffix: `win streak! 🔥`,
        highlight: streak.toString(),
        highlightColor: 'text-red-400',
      }
    case 4: // Type E: VIP unlock
      return {
        id,
        username,
        type: 'vip',
        text: `unlocked VIP Signal 🔓`,
        highlight: username,
        highlightColor: 'text-cyan-300',
      }
    default:
      return {
        id,
        username,
        type: 'coins',
        coins: 100,
        text: `just won`,
        suffix: `Coins! 💰`,
        highlight: '100',
        highlightColor: 'text-amber-400',
      }
  }
}

const ActivityFeed = ({ matchHistory }: { matchHistory: Array<{ home: string; away: string; result: string }> }) => {
  const [activities, setActivities] = useState(() => {
    return Array.from({ length: 15 }, (_, i) => generateActivity(i))
  })

  // Add match results to feed
  useEffect(() => {
    if (matchHistory.length > 0) {
      const latestMatch = matchHistory[matchHistory.length - 1]
      const matchActivity: any = {
        id: Date.now(),
        type: 'match',
        text: latestMatch.result,
        username: '', // Not used for match type
      }
      setActivities((prev) => [...prev.slice(1), matchActivity])
    }
  }, [matchHistory])

  useEffect(() => {
    const interval = setInterval(() => {
      setActivities((prev) => {
        const newActivity = generateActivity(Date.now())
        return [...prev.slice(1), newActivity]
      })
    }, 3000)

    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative h-64 overflow-hidden rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl">
      {/* Top gradient mask */}
      <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-slate-900 via-slate-900/80 to-transparent z-10 pointer-events-none" />
      
      {/* Bottom gradient mask */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent z-10 pointer-events-none" />
      
      <div className="h-full overflow-hidden">
        <div className="py-2">
          <AnimatePresence mode="popLayout">
            {activities.map((activity) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="px-4 py-3"
              >
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-slate-300 backdrop-blur-md shadow-[0_0_20px_rgba(59,130,246,0.2)] hover:shadow-[0_0_30px_rgba(59,130,246,0.3)] transition-shadow">
                  {activity.type === 'match' ? (
                    <span className="text-amber-300 font-semibold">⚽ {activity.text}</span>
                  ) : activity.type === 'vip' ? (
                    <>
                      <span className="text-cyan-300 font-semibold">User {activity.username}</span>
                      {' '}
                      <span className="text-slate-300">{activity.text}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-cyan-300 font-semibold">User {activity.username}</span>
                      {' '}
                      <span className="text-slate-400">{activity.text}</span>
                      {' '}
                      <span className={`${activity.highlightColor} font-bold`}>{activity.highlight}</span>
                      {' '}
                      <span className="text-slate-400">{activity.suffix}</span>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

// Community Jackpot Component
const CommunityJackpot = () => {
  const [totalWon, setTotalWon] = useState(14520900)
  
  // Simulate increasing jackpot
  useEffect(() => {
    const interval = setInterval(() => {
      setTotalWon((prev) => prev + Math.floor(Math.random() * 1000))
    }, 5000)
    return () => clearInterval(interval)
  }, [])
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border-2 border-yellow-500/30 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 p-6 shadow-[0_0_40px_rgba(234,179,8,0.2)] backdrop-blur-xl"
    >
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">
        COMMUNITY TOTAL WON
      </p>
      <motion.div
        key={totalWon}
        initial={{ scale: 1.05 }}
        animate={{ scale: 1 }}
        className="flex items-center gap-3"
      >
        <span className="text-3xl">⚠️</span>
        <span className="text-4xl md:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 drop-shadow-[0_0_20px_rgba(251,191,36,0.8)]">
          {totalWon.toLocaleString()} Coins
        </span>
      </motion.div>
      <div className="mt-2 h-1 bg-slate-700/50 rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500"
          initial={{ width: '0%' }}
          animate={{ width: '100%' }}
          transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
        />
      </div>
    </motion.div>
  )
}

// Intel Board Component - Random intelligence board shown after betting
const IntelBoard = ({
  type,
  userBet,
  currentMatch,
  onInviteClick,
  onChannelClick,
}: {
  type: 'SENTIMENT' | 'GREED' | 'AI_TEASER'
  userBet: { type: BetType | null; amount: number }
  currentMatch: Match
  onInviteClick: () => void
  onChannelClick: () => void
}) => {
  if (type === 'SENTIMENT') {
    // Generate random market volume percentages
    const homePercent = Math.floor(Math.random() * 40) + 40 // 40-80%
    const awayPercent = Math.floor(Math.random() * 30) + 10 // 10-40%
    const drawPercent = 100 - homePercent - awayPercent
    
    // Determine if user is contrarian
    const userBetType = userBet.type?.toUpperCase()
    const isContrarian = 
      (userBetType === 'HOME' && homePercent < 50) ||
      (userBetType === 'AWAY' && awayPercent < 50) ||
      (userBetType === 'DRAW' && drawPercent < 20)
    const isHeavy = 
      (userBetType === 'HOME' && homePercent > 60) ||
      (userBetType === 'AWAY' && awayPercent > 40) ||
      (userBetType === 'DRAW' && drawPercent > 15)
    
    return (
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="rounded-2xl border-2 border-cyan-500/30 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 p-4 shadow-[0_0_30px_rgba(6,182,212,0.3)] backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">📊</span>
          <p className="text-lg font-bold text-cyan-300">LIVE MARKET VOLUME</p>
        </div>
        
        <div className="space-y-3 mb-4">
          {/* Home Volume */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-300">Home</span>
              <span className="text-cyan-300 font-semibold">{homePercent}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${homePercent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-cyan-400 to-cyan-600"
              />
            </div>
          </div>
          
          {/* Draw Volume */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-300">Draw</span>
              <span className="text-amber-300 font-semibold">{drawPercent}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${drawPercent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-amber-400 to-amber-600"
              />
            </div>
          </div>
          
          {/* Away Volume */}
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-slate-300">Away</span>
              <span className="text-purple-300 font-semibold">{awayPercent}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${awayPercent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-purple-400 to-purple-600"
              />
            </div>
          </div>
        </div>
        
        {isContrarian && (
          <p className="text-sm text-green-400 font-semibold mb-2">
            ⚠️ Contrarian Bet detected! Smart money is with you.
          </p>
        )}
        {isHeavy && (
          <p className="text-sm text-red-400 font-semibold mb-2">
            ⚠️ Public is heavy on this side. Beware of traps!
          </p>
        )}
      </motion.div>
    )
  }
  
  if (type === 'GREED') {
    const potentialWin = userBet.amount * (userBet.type ? currentMatch.odds[userBet.type] : 1)
    
    return (
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="rounded-2xl border-2 border-yellow-500/30 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 p-4 shadow-[0_0_30px_rgba(251,191,36,0.3)] backdrop-blur-xl"
      >
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">💰</span>
          <p className="text-lg font-bold text-yellow-300">PROFIT OPPORTUNITY</p>
        </div>
        
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs text-slate-400 mb-1">Potential Win</p>
            <p className="text-lg font-semibold text-slate-300">
              +{potentialWin.toLocaleString()} Coins
            </p>
          </div>
          
          <motion.div
            animate={{ 
              boxShadow: [
                '0_0_20px_rgba(251,191,36,0.4)',
                '0_0_30px_rgba(251,191,36,0.6)',
                '0_0_20px_rgba(251,191,36,0.4)',
              ]
            }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            className="rounded-xl border-2 border-yellow-400/50 bg-gradient-to-br from-yellow-500/20 to-amber-500/20 p-3"
          >
            <p className="text-xs text-yellow-300 mb-1">Invite Reward</p>
            <p className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-amber-300 to-yellow-300">
              +500 Coins
            </p>
          </motion.div>
        </div>
        
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onInviteClick}
          className="w-full rounded-xl bg-gradient-to-r from-green-400 via-emerald-500 to-green-600 px-4 py-3 text-base font-bold text-white shadow-[0_0_20px_rgba(34,197,94,0.4)]"
        >
          Claim 500 Coins 🚀
        </motion.button>
      </motion.div>
    )
  }
  
  // AI_TEASER
  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="rounded-2xl border-2 border-blue-500/30 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 p-4 shadow-[0_0_30px_rgba(59,130,246,0.3)] backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 mb-4">
        <span className="text-2xl">🤖</span>
        <p className="text-lg font-bold text-blue-300">AI MODEL ALERT</p>
      </div>
      
      <div className="rounded-xl border border-white/10 bg-black/40 p-3 mb-4 font-mono text-xs text-green-400 overflow-hidden">
        <motion.div
          animate={{ x: [0, -100, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          className="whitespace-nowrap"
        >
          {'> AI Model detected a significant odds divergence...'.repeat(3)}
        </motion.div>
      </div>
      
      <p className="text-sm text-slate-300 mb-4">
        AI Model detected a significant odds divergence. Unlock full analysis in our channel.
      </p>
      
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={onChannelClick}
        className="w-full rounded-xl border-2 border-blue-400/50 bg-gradient-to-r from-blue-500/20 to-indigo-500/20 px-4 py-3 text-base font-bold text-blue-300 shadow-[0_0_20px_rgba(59,130,246,0.4)] flex items-center justify-center gap-2"
      >
        <span>🔓</span>
        <span>Unlock Analysis in Channel</span>
      </motion.button>
    </motion.div>
  )
}

// The Truth messages (Community Values)
const TRUTH_MESSAGES = [
  {
    en: 'Gambling is luck. Trading is math. Stop guessing.',
    zh: '赌博靠运，交易靠数。别瞎猜。',
  },
  {
    en: 'The Banker feeds on your emotions. Stay cold. Use Data.',
    zh: '庄家吃的是你的人性。保持冷静，相信数据。',
  },
  {
    en: 'Alone, you are liquidity. Together, we are the Whale.',
    zh: '一个人你是韭菜，在一起我们就是巨鲸。',
  },
  {
    en: 'Match-fixing is an excuse. Probability is the reality.',
    zh: '假球是借口，概率才是真相。',
  },
]

// Live commentary phrases
const COMMENTARY = {
  normal: [
    'Good pass...',
    'Midfield battle...',
    'Looking for space...',
    'Building up play...',
    'Controlling possession...',
    'Switching sides...',
    'Patient build-up...',
  ],
  danger: [
    'Dangerous attack!',
    'Through ball to striker!',
    'Free kick opportunity!',
    'Counter attack!',
    'Shot on target!',
    'Corner kick!',
    'Penalty area threat!',
  ],
  goal: [
    'GOAL!!!! ⚽️',
    'What a finish!',
    'Unstoppable shot!',
    'Incredible strike!',
    'Back of the net!',
    'Magnificent goal!',
  ],
}

// Generate random form (5 recent matches)
const generateRandomForm = (): FormResult[] => {
  const results: FormResult[] = []
  for (let i = 0; i < 5; i++) {
    const rand = Math.random()
    if (rand < 0.4) {
      results.push('W') // 40% win
    } else if (rand < 0.7) {
      results.push('D') // 30% draw
    } else {
      results.push('L') // 30% loss
    }
  }
  return results
}

// Generate random odds trend
const generateOddsTrend = (): { home: 'up' | 'down' | null; draw: 'up' | 'down' | null; away: 'up' | 'down' | null } => {
  const getTrend = () => {
    const rand = Math.random()
    if (rand < 0.3) return 'up'
    if (rand < 0.6) return 'down'
    return null
  }
  return {
    home: getTrend(),
    draw: getTrend(),
    away: getTrend(),
  }
}

// Generate random match
const generateRandomMatch = (): Match => {
  const shuffled = [...TEAM_POOL].sort(() => Math.random() - 0.5)
  const home = shuffled[0]
  const away = shuffled[1]
  
  return {
    home,
    away,
    homeForm: generateRandomForm(),
    awayForm: generateRandomForm(),
    odds: {
      home: Number((Math.random() * 1.0 + 1.5).toFixed(2)),
      draw: Number((Math.random() * 2.0 + 3.0).toFixed(2)),
      away: Number((Math.random() * 1.0 + 1.8).toFixed(2)),
    },
    oddsTrend: generateOddsTrend(),
  }
}

// Generate random result (weighted by odds - lower odds = higher win probability)
const generateRandomResult = (match: Match): { home: number; away: number } => {
  // Calculate win probabilities based on odds
  const homeProb = 1 / match.odds.home
  const drawProb = 1 / match.odds.draw
  const awayProb = 1 / match.odds.away
  const totalProb = homeProb + drawProb + awayProb
  
  const rand = Math.random() * totalProb
  
  if (rand < homeProb) {
    // Home wins
    return {
      home: Math.floor(Math.random() * 3) + 1,
      away: Math.floor(Math.random() * 2),
    }
  } else if (rand < homeProb + drawProb) {
    // Draw
    const score = Math.floor(Math.random() * 3)
    return { home: score, away: score }
  } else {
    // Away wins
    return {
      home: Math.floor(Math.random() * 2),
      away: Math.floor(Math.random() * 3) + 1,
    }
  }
}

// Game cycle constants
const BETTING_TIME = 20 // seconds - Phase 1: Betting period
const LOCKED_TIME = 25  // seconds - Phase 2: Match period (script playback)
const RESULT_TIME = 5   // seconds - Phase 3: Result period
const TOTAL_CYCLE = BETTING_TIME + LOCKED_TIME + RESULT_TIME // 50 seconds total

function App() {
  const [timeLeft, setTimeLeft] = useState(TOTAL_CYCLE)
  const [gameState, setGameState] = useState<GameState>('BETTING')
  const [currentMatch, setCurrentMatch] = useState<Match>(generateRandomMatch())
  const [userBet, setUserBet] = useState<UserBet>({ type: null, amount: 0 })
  const [matchResult, setMatchResult] = useState<{ home: number; away: number } | null>(null)
  const [coins, setCoins] = useState(1000)
  const [showWinModal, setShowWinModal] = useState(false)
  const [showReviveModal, setShowReviveModal] = useState(false)
  const [showRulesModal, setShowRulesModal] = useState(false)
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [isMusicStarted, setIsMusicStarted] = useState(false)
  const [lang, setLang] = useState<Lang>('en')
  const [matchHistory, setMatchHistory] = useState<Array<{ home: string; away: string; result: string }>>([])
  const [commentary, setCommentary] = useState<string>('')
  const [betResult, setBetResult] = useState<'win' | 'lose' | null>(null)
  const [showBigWin, setShowBigWin] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showStreakEffect, setShowStreakEffect] = useState<'fire' | 'ice' | null>(null)
  // Streak counters (used internally for effect triggers)
  const [, setWinStreakCount] = useState(0)
  const [, setLossStreakCount] = useState(0)
  const [showTruthModal, setShowTruthModal] = useState(false)
  const [truthMessage, setTruthMessage] = useState<{ en: string; zh: string } | null>(null)
  const [showSplash, setShowSplash] = useState(true)
  // Round Result Snapshot - stores the final result to prevent state sync issues
  const [roundResult, setRoundResult] = useState<{ 
    isWin: boolean
    profit: number
    result: string
    userPick: string
    matchScore: string
  } | null>(null)
  // Intel Board Type - random intelligence board shown after betting
  const [intelType, setIntelType] = useState<'SENTIMENT' | 'GREED' | 'AI_TEASER' | null>(null)
  // Match Script Engine - timeline events for match period
  const [matchScript, setMatchScript] = useState<Array<{ time: number; type: 'goal' | 'whistle_start' | 'whistle_end'; team: 'home' | 'away' | null }>>([])
  const [liveScore, setLiveScore] = useState<{ home: number; away: number }>({ home: 0, away: 0 })
  const [showGoalFlash, setShowGoalFlash] = useState(false)
  // Floating text animation for bet feedback
  const [floatingTexts, setFloatingTexts] = useState<Array<{ id: number; text: string; x: number; y: number }>>([])
  // Fan Energy for Smash to Boost
  const [fanEnergy, setFanEnergy] = useState(0)
  // Wallet icon animation state (used for claim animation)
  const [walletPulse, setWalletPulse] = useState(false)

  const t = translations[lang]

  // Telegram WebApp - Force fullscreen and ready state
  useEffect(() => {
    if (window.Telegram?.WebApp) {
      // Force expand to fullscreen
      window.Telegram.WebApp.expand()
      // Notify Telegram that the app is ready
      window.Telegram.WebApp.ready()
    }
  }, [])

  const bgmRef = useRef<HTMLAudioElement | null>(null)
  const clickRef = useRef<HTMLAudioElement | null>(null)
  const winRef = useRef<HTMLAudioElement | null>(null)
  const goalRef = useRef<HTMLAudioElement | null>(null)
  const crowdGaspRef = useRef<HTMLAudioElement | null>(null)
  const whistleRef = useRef<HTMLAudioElement | null>(null)
  const currentMatchRef = useRef<Match>(currentMatch)
  const userBetRef = useRef<UserBet>(userBet)
  
  // Keep refs in sync with state
  useEffect(() => {
    currentMatchRef.current = currentMatch
  }, [currentMatch])
  
  useEffect(() => {
    userBetRef.current = userBet
  }, [userBet])

  // Unified audio unlock function
  // Audio files required in public folder:
  // - bgm.wav (background music)
  // - click.wav (button click sound)
  // - win.wav (win sound)
  // - voice_goal.mp3 (goal commentary)
  // - crowd_gasp.mp3 (crowd reaction)
  // - whistle.mp3 (referee whistle)
  const unlockAudioContext = useCallback(async () => {
    if (!isMusicStarted) {
      try {
        // Unlock AudioContext by playing BGM
        if (bgmRef.current) {
          await bgmRef.current.play()
          bgmRef.current.volume = 0.5
          console.log('Audio Context Unlocked')
          console.log('BGM Started')
        }
        
        // Pre-play all audio elements to unlock them (silently)
        const audioElements = [
          clickRef.current,
          winRef.current,
          goalRef.current,
          crowdGaspRef.current,
          whistleRef.current,
        ]
        
        for (const audio of audioElements) {
          if (audio) {
            try {
              await audio.play()
              audio.pause()
              audio.currentTime = 0
            } catch (e) {
              console.warn('Audio pre-play failed (this is normal):', e)
            }
          }
        }
        
        setIsMusicStarted(true)
      } catch (error) {
        console.error('Audio Context Unlock Error:', error)
      }
    }
  }, [isMusicStarted])

  // Initialize audio elements
  useEffect(() => {
    // Initialize all audio elements
    bgmRef.current = new Audio('/bgm.wav')
    bgmRef.current.loop = true
    bgmRef.current.volume = 0.5

    clickRef.current = new Audio('/click.wav')
    winRef.current = new Audio('/win.wav')
    
    // Stadium audio effects
    goalRef.current = new Audio('/voice_goal.mp3')
    goalRef.current.volume = 1.0
    
    crowdGaspRef.current = new Audio('/crowd_gasp.mp3')
    crowdGaspRef.current.volume = 0.6
    
    whistleRef.current = new Audio('/whistle.mp3')
    whistleRef.current.volume = 0.8

    // AudioContext unlock mechanism - one-time click handler
    const handleFirstClick = () => {
      unlockAudioContext()
    }

    // Add listener to document for any click anywhere (one-time)
    document.addEventListener('click', handleFirstClick, { once: true })

    return () => {
      document.removeEventListener('click', handleFirstClick)
      bgmRef.current?.pause()
      bgmRef.current = null
    }
  }, [unlockAudioContext])

  // Handle mute toggle - pause/play based on mute state
  useEffect(() => {
    if (bgmRef.current && isMusicStarted) {
      if (isMuted) {
        bgmRef.current.pause()
        console.log('BGM Paused (Muted)')
      } else {
        bgmRef.current.play().catch((error) => {
          console.error('BGM Resume Error:', error)
        })
        console.log('BGM Resumed (Unmuted)')
      }
    }
  }, [isMuted, isMusicStarted])

  // Splash screen - show for 2 seconds on load
  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false)
    }, 2000)
    return () => clearTimeout(timer)
  }, [])

  // Handle tap to start audio unlock (EMERGENCY FIX: Close overlay first, then try audio)
  const handleTapToStart = async () => {
    // STEP 1: Immediately close the overlay - user must be able to enter the game
    setIsMusicStarted(true)
    
    // STEP 2: Try to unlock audio directly (bypass isMusicStarted check)
    try {
      // Unlock AudioContext by playing BGM
      if (bgmRef.current) {
        try {
          await bgmRef.current.play()
          bgmRef.current.volume = 0.5
          console.log('Audio Context Unlocked')
          console.log('BGM Started')
        } catch (e) {
          console.warn('BGM play failed:', e)
        }
      }
      
      // Pre-play all audio elements to unlock them (silently)
      const audioElements = [
        clickRef.current,
        winRef.current,
        goalRef.current,
        crowdGaspRef.current,
        whistleRef.current,
      ]
      
      for (const audio of audioElements) {
        if (audio) {
          try {
            await audio.play()
            audio.pause()
            audio.currentTime = 0
          } catch (e) {
            console.warn('Audio pre-play failed (this is normal):', e)
          }
        }
      }
    } catch (error) {
      console.error("Audio failed but game started:", error)
    }
  }

  // Audio triggers for gameState changes
  useEffect(() => {
    if (isMuted) {
      console.log('Audio muted, skipping whistle')
      return
    }

    if (gameState === 'LOCKED' && whistleRef.current) {
      // Play whistle when match starts
      console.log('Attempting to play whistle (match start)...')
      whistleRef.current.currentTime = 0
      whistleRef.current.play()
        .then(() => {
          console.log('Whistle audio played successfully (match start)')
        })
        .catch((e) => {
          console.error('Audio play failed (whistle - match start):', e)
          console.error('File path: /whistle.mp3')
        })
    } else if (gameState === 'RESULT' && whistleRef.current) {
      // Play whistle when match ends
      console.log('Attempting to play whistle (match end)...')
      whistleRef.current.currentTime = 0
      whistleRef.current.play()
        .then(() => {
          console.log('Whistle audio played successfully (match end)')
        })
        .catch((e) => {
          console.error('Audio play failed (whistle - match end):', e)
          console.error('File path: /whistle.mp3')
        })
    }
  }, [gameState, isMuted])

  // Trigger "The Truth" modal after result modal closes (30% chance)
  const handleResultModalClose = () => {
    setShowWinModal(false)
    setRoundResult(null) // Clear result snapshot when closing modal
    // 30% chance to show truth modal
    if (Math.random() < 0.3) {
      const randomMessage = TRUTH_MESSAGES[Math.floor(Math.random() * TRUTH_MESSAGES.length)]
      setTruthMessage(randomMessage)
      setTimeout(() => {
        setShowTruthModal(true)
      }, 500) // Small delay after closing result modal
    }
  }

  // Match Script Engine - Generate timeline events for match period
  const generateMatchScript = useCallback((finalScore: { home: number; away: number }) => {
    const events: Array<{ time: number; type: 'goal' | 'whistle_start' | 'whistle_end'; team: 'home' | 'away' | null }> = []
    
    // Start whistle at t=0
    events.push({ time: 0, type: 'whistle_start', team: null })
    
    // Generate goal events based on final score
    let homeGoals = finalScore.home
    let awayGoals = finalScore.away
    const totalGoals = homeGoals + awayGoals
    
    // Distribute goals randomly across the 25-second match period
    for (let i = 0; i < totalGoals; i++) {
      const team: 'home' | 'away' = homeGoals > 0 && (awayGoals === 0 || Math.random() < 0.5) ? 'home' : 'away'
      if (team === 'home') homeGoals--
      else awayGoals--
      
      // Random time between 1-24 seconds (avoid 0 and 25)
      const goalTime = Math.floor(Math.random() * 23) + 1
      events.push({ time: goalTime, type: 'goal', team })
    }
    
    // End whistle at t=25
    events.push({ time: LOCKED_TIME, type: 'whistle_end', team: null })
    
    // Sort by time
    events.sort((a, b) => a.time - b.time)
    
    return events
  }, [])

  // Game loop engine - 50 second cycle (20s betting -> 25s locked -> 5s result)
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prevTime) => {
        const newTime = prevTime - 1

        // Last 3 seconds of betting phase - red flash + vibration
        if (newTime <= 3 && newTime > 0 && gameState === 'BETTING') {
          // Vibration feedback
          if (navigator.vibrate) {
            navigator.vibrate(200)
          }
          // Play tick sound
          if (!isMuted && clickRef.current) {
            clickRef.current.currentTime = 0
            clickRef.current.play().catch(() => {})
          }
        }

        // Transition to LOCKED at end of betting phase (20 seconds)
        if (newTime === LOCKED_TIME + RESULT_TIME) {
          // Generate final result FIRST
          const match = currentMatchRef.current
          const result = generateRandomResult(match)
          
          // Generate match script based on final result
          const script = generateMatchScript(result)
          setMatchScript(script)
          setMatchResult(result) // Store final result
          setLiveScore({ home: 0, away: 0 }) // Reset live score
          
          setGameState('LOCKED')
          
          // Play start whistle
          if (whistleRef.current && !isMuted) {
            whistleRef.current.currentTime = 0
            whistleRef.current.play().catch(() => {})
          }
        }

        // Generate result and transition to RESULT at end of locked phase (5 seconds)
        if (newTime === RESULT_TIME) {
          // ATOMIC OPERATION: All calculations in one function scope
          // Step 1: Get current values from refs (no state dependency)
          const match = currentMatchRef.current
          const bet = userBetRef.current
          
          // Step 2: Use the final result that was already generated when entering LOCKED state
          const result = matchResult || generateRandomResult(match)
          const homeScore = result.home
          const awayScore = result.away
          
          // Play end whistle
          if (whistleRef.current && !isMuted) {
            whistleRef.current.currentTime = 0
            whistleRef.current.play().catch(() => {})
          }
          
          // Step 3: Determine match result type (HOME/DRAW/AWAY) - standardized uppercase
          let matchResultType: 'HOME' | 'DRAW' | 'AWAY'
          if (homeScore > awayScore) {
            matchResultType = 'HOME'
          } else if (homeScore === awayScore) {
            matchResultType = 'DRAW'
          } else {
            matchResultType = 'AWAY'
          }
          
          // Step 4: Determine if user won (using temporary variables, standardized comparison)
          let isWin = false
          let profit = 0
          let userPick = ''
          
          if (bet.type && bet.amount > 0) {
            // Convert bet.type to uppercase for standardized comparison
            const userBetType = bet.type.toUpperCase() as 'HOME' | 'DRAW' | 'AWAY'
            userPick = userBetType
            
            // Compare user bet with match result
            if (userBetType === matchResultType) {
              isWin = true
              // Calculate payout
              profit = Math.floor(bet.amount * match.odds[bet.type])
            }
          }
          
          // Step 5: Create result snapshot FIRST (before any state updates)
          const matchScore = `${homeScore}-${awayScore}`
          setRoundResult({
            isWin,
            profit,
            result: matchResultType,
            userPick,
            matchScore,
          })
          
          // Step 6: Process win/loss effects (after snapshot is set)
          if (bet.type && bet.amount > 0) {
            if (isWin) {
              // WIN: Update coins
              setCoins((c) => c + profit)
              setBetResult('win')
              setShowWinModal(true)
              setShowBigWin(true)
              
              // Update win streak
              setWinStreakCount((prev) => {
                const newStreak = prev + 1
                setLossStreakCount(0) // Reset loss streak
                // Trigger fire effect if 3+ wins
                if (newStreak >= 3) {
                  setShowStreakEffect('fire')
                  setTimeout(() => setShowStreakEffect(null), 3000)
                }
                return newStreak
              })
              
              // Play win sound
              if (winRef.current && !isMuted) {
                winRef.current.currentTime = 0
                winRef.current.play().catch(() => {})
              }
              
              // Enhanced confetti
              confetti({
                particleCount: 200,
                spread: 100,
                origin: { y: 0.5 },
              })
              // Multiple bursts for celebration
              setTimeout(() => {
                confetti({
                  particleCount: 100,
                  angle: 60,
                  spread: 55,
                  origin: { x: 0 },
                })
                confetti({
                  particleCount: 100,
                  angle: 120,
                  spread: 55,
                  origin: { x: 1 },
                })
              }, 250)
            } else {
              // LOSE: Update loss streak
              setBetResult('lose')
              setShowWinModal(true) // Show modal even on loss
              
              // Update loss streak
              setLossStreakCount((prev) => {
                const newStreak = prev + 1
                setWinStreakCount(0) // Reset win streak
                // Trigger ice effect if 3+ losses
                if (newStreak >= 3) {
                  setShowStreakEffect('ice')
                  setTimeout(() => setShowStreakEffect(null), 3000)
                }
                return newStreak
              })
            }
          } else {
            // No bet placed - don't show modal, but still set roundResult for consistency
            setShowWinModal(false)
          }
          
          // Step 6: Update match result and history (after all calculations)
          setMatchResult(result)
          
          // Add to match history
          const resultStr = `${match.home} ${result.home}-${result.away} ${match.away}`
          setMatchHistory((prev) => [...prev.slice(-19), { 
            home: match.home, 
            away: match.away, 
            result: resultStr 
          }])
          
          // Step 7: Update game state (after all calculations)
          setGameState('RESULT')
        }

        // Reset at 0 seconds - start new match
        if (newTime === 0) {
          const newMatch = generateRandomMatch()
          setCurrentMatch(newMatch)
          setUserBet({ type: null, amount: 0 })
          setMatchResult(null)
          setGameState('BETTING')
          setBetResult(null)
          setCommentary('')
          setShowBigWin(false)
          setRoundResult(null) // Clear result snapshot
          setIntelType(null) // Reset intel board
          setMatchScript([]) // Clear match script
          setLiveScore({ home: 0, away: 0 }) // Reset live score
          setShowGoalFlash(false) // Reset goal flash
          setFanEnergy(0) // Reset fan energy
          return TOTAL_CYCLE
        }

        return newTime
      })
    }, 1000)

    return () => clearInterval(interval)
  }, [gameState, currentMatch, isMuted])

  // Match Script Engine - Execute timeline events during LOCKED state
  useEffect(() => {
    if (gameState !== 'LOCKED' || matchScript.length === 0) {
      return
    }

    const executedEvents = new Set<number>()
    
    const checkEvents = () => {
      // Calculate match time: when timeLeft goes from (LOCKED_TIME + RESULT_TIME) to RESULT_TIME
      // Match time = (LOCKED_TIME + RESULT_TIME) - timeLeft
      const matchTime = (LOCKED_TIME + RESULT_TIME) - timeLeft
      
      matchScript.forEach((event) => {
        if (!executedEvents.has(event.time) && matchTime >= event.time && matchTime < event.time + 1) {
          executedEvents.add(event.time)
          
          if (event.type === 'goal') {
            // Update live score
            setLiveScore((prev) => ({
              home: event.team === 'home' ? prev.home + 1 : prev.home,
              away: event.team === 'away' ? prev.away + 1 : prev.away,
            }))
            
            // Goal effects: flash, vibration, sound
            setShowGoalFlash(true)
            setTimeout(() => setShowGoalFlash(false), 500)
            
            if (navigator.vibrate) {
              navigator.vibrate([100, 50, 100, 50, 200])
            }
            
            if (goalRef.current && !isMuted) {
              goalRef.current.currentTime = 0
              goalRef.current.play().catch(() => {})
            }
          } else if (event.type === 'whistle_end') {
            // End whistle already handled in game loop
          }
        }
      })
    }
    
    const interval = setInterval(checkEvents, 200)
    
    return () => clearInterval(interval)
  }, [gameState, matchScript, timeLeft, isMuted])

  // Live commentary during LOCKED state
  useEffect(() => {
    if (gameState !== 'LOCKED') {
      setCommentary('')
      return
    }

    const updateCommentary = () => {
      const rand = Math.random()
      let phrase = ''

      if (rand < 0.6) {
        // 60% normal
        phrase = COMMENTARY.normal[Math.floor(Math.random() * COMMENTARY.normal.length)]
      } else if (rand < 0.9) {
        // 30% danger
        phrase = COMMENTARY.danger[Math.floor(Math.random() * COMMENTARY.danger.length)]
      } else {
        // 10% goal
        phrase = COMMENTARY.goal[Math.floor(Math.random() * COMMENTARY.goal.length)]
      }

      setCommentary(phrase)
    }

    // Initial commentary
    updateCommentary()

    // Update every 1.5 seconds
    const interval = setInterval(updateCommentary, 1500)

    return () => clearInterval(interval)
  }, [gameState])

  // Auto-hide BIG WIN! after 3 seconds
  useEffect(() => {
    if (showBigWin) {
      const timer = setTimeout(() => {
        setShowBigWin(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [showBigWin])

  const playSfx = (type: 'click' | 'win') => {
    if (isMuted) {
      console.log(`SFX ${type} skipped (muted)`)
      return
    }

    const audio = type === 'click' ? clickRef.current : winRef.current
    const fileName = type === 'click' ? '/click.wav' : '/win.wav'
    
    if (audio) {
      audio.currentTime = 0
      audio.play()
        .then(() => {
          console.log(`SFX ${type} played successfully`)
        })
        .catch((e) => {
          console.error(`Audio play failed (${type}):`, e)
          console.error(`File path: ${fileName}`)
        })
    } else {
      console.error(`${type}Ref.current is null`)
    }
  }

  const toggleMute = () => {
    setIsMuted((prev) => !prev)
  }

  const toggleLang = () => {
    playSfx('click')
    setLang((prev) => (prev === 'en' ? 'zh' : 'en'))
  }

  const handlePlaceBet = (type: BetType, event?: React.MouseEvent<HTMLButtonElement>) => {
    if (gameState !== 'BETTING') return

    const betAmount = 100
    if (coins < betAmount) {
      setShowReviveModal(true)
      return
    }

    playSfx('click')
    
    // Haptic feedback
    if (navigator.vibrate) {
      navigator.vibrate(50)
    }
    
    // Floating text animation
    if (event) {
      const rect = event.currentTarget.getBoundingClientRect()
      const x = rect.left + rect.width / 2
      const y = rect.top
      const id = Date.now()
      setFloatingTexts((prev) => [...prev, { id, text: `-${betAmount}`, x, y }])
      
      // Remove after animation
      setTimeout(() => {
        setFloatingTexts((prev) => prev.filter((t) => t.id !== id))
      }, 2000)
    }
    
    setCoins((prev) => prev - betAmount)
    setUserBet({ type, amount: betAmount })
    
    // Randomly select intel type after successful bet
    const rand = Math.random()
    if (rand < 0.4) {
      setIntelType('SENTIMENT')
    } else if (rand < 0.8) {
      setIntelType('GREED')
    } else {
      setIntelType('AI_TEASER')
    }
  }

  const handleInviteForRewards = () => {
    setCoins((prev) => prev + 500)
    setShowReviveModal(false)
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className={`relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-slate-100 ${
      (timeLeft <= 3 && timeLeft > 0 && gameState === 'BETTING') || showGoalFlash
        ? 'animate-pulse border-4 border-red-500/50' 
        : ''
    }`}>
      {/* Floating Text Animations */}
      <AnimatePresence>
        {floatingTexts.map((text) => (
          <FloatingText key={text.id} text={text.text} x={text.x} y={text.y} />
        ))}
      </AnimatePresence>
      
      <div className="pointer-events-none absolute inset-0 opacity-20">
        <div
          className="h-full w-full bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1517927033932-b3d18e61fb3a?auto=format&fit=crop&w=1600&q=80')",
          }}
        />
      </div>

      <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        {/* Top bar */}
        <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-[0_0_20px_rgba(59,130,246,0.35)] backdrop-blur-lg">
          <div className="flex items-center gap-3">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                playSfx('click')
                setShowLeaderboardModal(true)
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] transition hover:bg-white/20 focus:outline-none"
            >
              <Trophy className="h-5 w-5" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                playSfx('click')
                setShowRulesModal(true)
              }}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] transition hover:bg-white/20 focus:outline-none"
            >
              <Info className="h-5 w-5" />
            </motion.button>
            <div className="flex flex-col min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-400">
                LIVE PREDICTION MARKET
              </p>
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-lg font-bold text-slate-100 whitespace-nowrap">
                  OddsFlow
                </p>
                <span className="text-[10px] font-bold bg-black text-amber-400 px-1.5 py-0.5 rounded leading-tight shrink-0">
                  AI
                </span>
                <p className="text-lg font-bold text-slate-100 whitespace-nowrap">
                  Exchange
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <motion.div
              animate={walletPulse ? { scale: [1, 1.5, 1] } : {}}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm font-semibold text-amber-100 shadow-[0_0_15px_rgba(251,191,36,0.45)]"
            >
              <span className="text-lg">🪙</span>
              <span className="text-white font-bold">{coins.toLocaleString()}</span>
            </motion.div>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleLang}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] transition hover:bg-white/20 focus:outline-none text-xs font-bold"
            >
              {lang === 'en' ? '中' : 'EN'}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleMute}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] transition hover:bg-white/20 focus:outline-none"
            >
              {isMuted ? (
                <VolumeX className="h-5 w-5" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </motion.button>
          </div>
        </div>

        {/* Countdown Timer */}
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 shadow-[0_0_20px_rgba(59,130,246,0.35)] backdrop-blur-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-[0.2em] text-cyan-400">
              {gameState === 'BETTING' ? 'BETTING OPEN' : gameState === 'LOCKED' ? 'MATCH IN PROGRESS' : 'RESULT'}
            </span>
            <span className={`text-lg font-bold ${
              gameState === 'BETTING' ? 'text-green-400' : 
              gameState === 'LOCKED' ? 'text-red-400' : 
              'text-amber-400'
            }`}>
              {formatTime(timeLeft)}
            </span>
          </div>
          <div className="h-3 bg-slate-700 rounded-full overflow-hidden">
            <motion.div
              className={`h-full ${
                gameState === 'BETTING' 
                  ? 'bg-gradient-to-r from-green-400 to-emerald-500' 
                  : gameState === 'LOCKED'
                  ? 'bg-gradient-to-r from-red-400 to-red-600 animate-pulse'
                  : 'bg-gradient-to-r from-amber-400 to-yellow-500'
              }`}
              initial={{ width: '100%' }}
              animate={{ width: `${(timeLeft / TOTAL_CYCLE) * 100}%` }}
              transition={{ duration: 1, ease: 'linear' }}
            />
          </div>
        </div>

        {/* Immersive Holographic Stadium with Layered Layout */}
        <HolographicStadium
          gameState={gameState}
          matchResult={matchResult}
          currentMatch={currentMatch}
          commentary={commentary}
          isMuted={isMuted}
          goalRef={goalRef}
          crowdGaspRef={crowdGaspRef}
          liveScore={liveScore}
        />

        {/* Active Bet Indicator */}
        {userBet.type !== null && (
          <div className="flex items-center gap-3">
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-1 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 backdrop-blur-sm"
            >
              {gameState === 'BETTING' && (
                <div className="flex items-center gap-2 text-cyan-300">
                  <span>✅</span>
                  <span className="font-semibold text-sm md:text-base">
                    {t.you_bet} {userBet.amount} 🪙 {t.on} {userBet.type === 'home' ? t.home_win : userBet.type === 'draw' ? t.draw : t.away_win}
                  </span>
                </div>
              )}
              {gameState === 'RESULT' && betResult === 'win' && roundResult && (
                <div className="flex items-center gap-2 text-amber-300">
                  <span>🎉</span>
                  <span className="font-semibold text-sm md:text-base">
                    WIN! +{roundResult.profit} {t.coins}
                  </span>
                </div>
              )}
              {gameState === 'RESULT' && betResult === 'lose' && (
                <div className="flex items-center gap-2 text-red-300">
                  <span>❌</span>
                  <span className="font-semibold text-sm md:text-base">
                    {t.lost} {t.try_again}
                  </span>
                </div>
              )}
            </motion.div>
            {gameState === 'BETTING' && userBet.type !== null && (
              <motion.button
                whileTap={{ scale: 0.95 }}
                onClick={() => {
                  playSfx('click')
                  setShowShareModal(true)
                }}
                className="rounded-xl border border-cyan-400/30 bg-cyan-400/20 px-4 py-3 text-sm font-semibold text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.4)] hover:bg-cyan-400/30 transition"
              >
                Share ✈️
              </motion.button>
            )}
          </div>
        )}

        {/* Betting Buttons */}
        {gameState === 'BETTING' ? (
          <div className="grid grid-cols-3 gap-4">
            <motion.button
              whileTap={{ scale: 0.9 }}
              animate={coins >= 100 && userBet.type === null ? {
                scale: [1, 1.02, 1],
                boxShadow: [
                  '0_0_20px_rgba(255,255,255,0.1)',
                  '0_0_30px_rgba(34,211,238,0.4)',
                  '0_0_20px_rgba(255,255,255,0.1)',
                ],
              } : {}}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              onClick={(e) => handlePlaceBet('home', e)}
              disabled={coins < 100 || userBet.type !== null}
              className={`rounded-2xl border-2 p-5 text-center font-bold shadow-lg transition active:scale-95 active:opacity-80 ${
                userBet.type === 'home'
                  ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.5)]'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <p className="text-sm mb-1 opacity-80">Home Win</p>
              <div className="flex items-center justify-center gap-1 mb-2">
                <p className="text-2xl">{currentMatch.odds.home}x</p>
                {currentMatch.oddsTrend.home && (
                  <span className={`text-lg font-bold ${
                    currentMatch.oddsTrend.home === 'up' ? 'text-red-500' : 'text-green-500'
                  }`}>
                    {currentMatch.oddsTrend.home === 'up' ? '↑' : '↓'}
                  </span>
                )}
              </div>
              {userBet.type === 'home' ? (
                <p className="text-xs text-cyan-300">Bet: {userBet.amount} 🪙</p>
              ) : (
                <p className="text-xs opacity-60">Bet: 100 🪙</p>
              )}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.9 }}
              animate={coins >= 100 && userBet.type === null ? {
                scale: [1, 1.02, 1],
                boxShadow: [
                  '0_0_20px_rgba(255,255,255,0.1)',
                  '0_0_30px_rgba(251,191,36,0.4)',
                  '0_0_20px_rgba(255,255,255,0.1)',
                ],
              } : {}}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              onClick={(e) => handlePlaceBet('draw', e)}
              disabled={coins < 100 || userBet.type !== null}
              className={`rounded-2xl border-2 p-5 text-center font-bold shadow-lg transition active:scale-95 active:opacity-80 ${
                userBet.type === 'draw'
                  ? 'border-amber-400 bg-amber-400/20 text-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.5)]'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <p className="text-sm mb-1 opacity-80">Draw</p>
              <div className="flex items-center justify-center gap-1 mb-2">
                <p className="text-2xl">{currentMatch.odds.draw}x</p>
                {currentMatch.oddsTrend.draw && (
                  <span className={`text-lg font-bold ${
                    currentMatch.oddsTrend.draw === 'up' ? 'text-red-500' : 'text-green-500'
                  }`}>
                    {currentMatch.oddsTrend.draw === 'up' ? '↑' : '↓'}
                  </span>
                )}
              </div>
              {userBet.type === 'draw' ? (
                <p className="text-xs text-amber-300">Bet: {userBet.amount} 🪙</p>
              ) : (
                <p className="text-xs opacity-60">Bet: 100 🪙</p>
              )}
            </motion.button>

            <motion.button
              whileTap={{ scale: 0.9 }}
              animate={coins >= 100 && userBet.type === null ? {
                scale: [1, 1.02, 1],
                boxShadow: [
                  '0_0_20px_rgba(255,255,255,0.1)',
                  '0_0_30px_rgba(168,85,247,0.4)',
                  '0_0_20px_rgba(255,255,255,0.1)',
                ],
              } : {}}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
              onClick={(e) => handlePlaceBet('away', e)}
              disabled={coins < 100 || userBet.type !== null}
              className={`rounded-2xl border-2 p-5 text-center font-bold shadow-lg transition active:scale-95 active:opacity-80 ${
                userBet.type === 'away'
                  ? 'border-purple-400 bg-purple-400/20 text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.5)]'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <p className="text-sm mb-1 opacity-80">Away Win</p>
              <div className="flex items-center justify-center gap-1 mb-2">
                <p className="text-2xl">{currentMatch.odds.away}x</p>
                {currentMatch.oddsTrend.away && (
                  <span className={`text-lg font-bold ${
                    currentMatch.oddsTrend.away === 'up' ? 'text-red-500' : 'text-green-500'
                  }`}>
                    {currentMatch.oddsTrend.away === 'up' ? '↑' : '↓'}
                  </span>
                )}
              </div>
              {userBet.type === 'away' ? (
                <p className="text-xs text-purple-300">Bet: {userBet.amount} 🪙</p>
              ) : (
                <p className="text-xs opacity-60">Bet: 100 🪙</p>
              )}
            </motion.button>
          </div>
        ) : gameState === 'LOCKED' ? (
          <SmashToBoost
            onSmash={() => {
              setFanEnergy((prev) => prev + 1)
            }}
            fanEnergy={fanEnergy}
            isMuted={isMuted}
          />
        ) : (
          <div className="rounded-2xl border border-white/20 bg-white/5 p-6 text-center backdrop-blur-xl">
            <p className="text-sm text-slate-400">Match finished. Next round starting...</p>
          </div>
        )}

        {/* Intel Board - Show after betting */}
        {userBet.type !== null && intelType && gameState !== 'RESULT' && (
          <AnimatePresence mode="wait">
            <IntelBoard
              key={intelType}
              type={intelType}
              userBet={userBet}
              currentMatch={currentMatch}
              onInviteClick={() => {
                setShowShareModal(true)
              }}
              onChannelClick={() => {
                window.open('https://t.me/your_channel', '_blank')
              }}
            />
          </AnimatePresence>
        )}

        {/* Live Activity Feed */}
        <ActivityFeed matchHistory={matchHistory} />
        
        {/* Community Jackpot */}
        <div className="mt-4">
          <CommunityJackpot />
        </div>
      </div>

      <Modal
        show={showReviveModal}
        onClose={() => {
          handleInviteForRewards()
        }}
        title="Invite & Earn Rewards"
        description="Invite 1 Friend = +500 Coins 🪙"
        actionLabel="Invite & Earn"
        actionColor="green"
      />

      <ResultAnalysisModal
        show={showWinModal && roundResult !== null}
        onClose={handleResultModalClose}
        roundResult={roundResult}
        currentMatch={currentMatch}
        onClaim={() => {
          // Trigger wallet icon animation
          setWalletPulse(true)
          setTimeout(() => setWalletPulse(false), 500)
        }}
      />

      {userBet.type && (
        <ShareSlipModal
          show={showShareModal}
          onClose={() => setShowShareModal(false)}
        />
      )}

      <AnimatePresence>
        {showStreakEffect && <StreakEffect type={showStreakEffect} />}
      </AnimatePresence>

      {truthMessage && (
        <TruthModal
          show={showTruthModal}
          onClose={() => {
            setShowTruthModal(false)
            setTruthMessage(null)
          }}
          message={truthMessage}
          lang={lang}
        />
      )}

      <SplashScreen show={showSplash} />

      <TapToStartOverlay 
        show={!showSplash && !isMusicStarted} 
        onTap={handleTapToStart}
      />

      <RulesModal
        show={showRulesModal}
        onClose={() => setShowRulesModal(false)}
        t={t}
      />

      <LeaderboardModal
        show={showLeaderboardModal}
        onClose={() => setShowLeaderboardModal(false)}
        t={t}
      />

      {/* BIG WIN! Celebration */}
      <AnimatePresence>
        {showBigWin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ 
                scale: [0.5, 1.2, 1],
                opacity: [0, 1, 1],
                rotate: [0, 5, -5, 0],
              }}
              exit={{ scale: 0.5, opacity: 0 }}
              transition={{ 
                duration: 0.8,
                ease: 'easeOut',
              }}
              className="text-center"
            >
              <motion.h1
                className="text-7xl md:text-9xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 drop-shadow-[0_0_40px_rgba(251,191,36,0.8)]"
                animate={{
                  textShadow: [
                    '0 0 20px rgba(251,191,36,0.8), 0 0 40px rgba(251,191,36,0.6)',
                    '0 0 30px rgba(251,191,36,1), 0 0 60px rgba(251,191,36,0.8)',
                    '0 0 20px rgba(251,191,36,0.8), 0 0 40px rgba(251,191,36,0.6)',
                  ],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              >
                BIG WIN!
              </motion.h1>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
