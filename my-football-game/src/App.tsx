/*
 * ============================================
 * SUPABASE DATABASE SETUP
 * ============================================
 * 
 * Please run this SQL in your Supabase SQL Editor to create the users table:
 * 
 * CREATE TABLE users (
 *   telegram_id BIGINT UNIQUE,
 *   coins BIGINT DEFAULT 1000 NOT NULL,
 *   first_name TEXT,
 *   invited_by BIGINT,
 *   invited_rewarded BOOLEAN DEFAULT false NOT NULL
 * );
 * 
 * -- Optional: Create an index for faster lookups
 * CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
 *
 * -- Referral (atomic, one-time):
 * -- This RPC guarantees: on FIRST registration only, if inviter is valid (and not self):
 * --   - new user coins = 2000
 * --   - invited_by set
 * --   - inviter coins += 500
 * --   - invited_rewarded = true
 * -- Otherwise, new user coins = 1000 and no inviter reward.
 * ALTER TABLE users
 *   ADD COLUMN IF NOT EXISTS invited_rewarded BOOLEAN DEFAULT false NOT NULL;
 *
 * CREATE OR REPLACE FUNCTION register_user_with_referral(
 *   p_telegram_id BIGINT,
 *   p_first_name TEXT,
 *   p_inviter_id BIGINT
 * )
 * RETURNS TABLE (telegram_id BIGINT, coins BIGINT, first_name TEXT)
 * LANGUAGE plpgsql
 * AS $$
 * DECLARE
 *   effective_inviter BIGINT;
 * BEGIN
 *   effective_inviter := NULL;
 *   IF p_inviter_id IS NOT NULL AND p_inviter_id <> p_telegram_id THEN
 *     effective_inviter := p_inviter_id;
 *   END IF;
 *
 *   -- Insert only once (first registration). If already exists, do nothing and return existing row.
 *   INSERT INTO users (telegram_id, first_name, coins, invited_by, invited_rewarded)
 *   VALUES (
 *     p_telegram_id,
 *     p_first_name,
 *     CASE WHEN effective_inviter IS NULL THEN 1000 ELSE 2000 END,
 *     effective_inviter,
 *     CASE WHEN effective_inviter IS NULL THEN false ELSE true END
 *   )
 *   ON CONFLICT (telegram_id) DO NOTHING;
 *
 *   -- Reward inviter exactly once (only for a truly new user insert)
 *   IF effective_inviter IS NOT NULL THEN
 *     -- Only reward if the user row was inserted in this call (i.e., invited_rewarded is true AND invited_by matches)
 *     -- This protects against repeated calls for existing users.
 *     IF EXISTS (
 *       SELECT 1 FROM users u
 *       WHERE u.telegram_id = p_telegram_id
 *         AND u.invited_rewarded = true
 *         AND u.invited_by = effective_inviter
 *     ) THEN
 *       UPDATE users SET coins = coins + 500 WHERE telegram_id = effective_inviter;
 *     END IF;
 *   END IF;
 *
 *   RETURN QUERY
 *     SELECT u.telegram_id, u.coins, u.first_name
 *     FROM users u
 *     WHERE u.telegram_id = p_telegram_id;
 * END;
 * $$;
 * 
 * ============================================
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import confetti from 'canvas-confetti'
import { Volume2, VolumeX, Info, Trophy } from 'lucide-react'
import { supabase } from './supabaseClient'
import { LeaderboardModal } from './Leaderboard'
import { TaskModal } from './TaskModal'

// Telegram WebApp TypeScript declaration
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        expand: () => void
        ready: () => void
        setHeaderColor: (color: string) => void
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
}) => {
  // Lock body scroll when modal is open
  useEffect(() => {
    if (show) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [show])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative w-[90%] max-w-sm rounded-xl border border-white/10 bg-slate-900/80 p-4 shadow-[0_0_30px_rgba(59,130,246,0.4)]"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
          <div className="relative space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 shadow-[0_0_25px_rgba(99,102,241,0.7)]" />
      <div>
                <p className="text-base font-bold text-white">{title}</p>
                <p className="text-xs text-slate-300">{description}</p>
      </div>
            </div>
            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onClose}
              className={`w-full rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)] ${
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
}

const RulesModal = ({
  show,
  onClose,
  t,
}: {
  show: boolean
  onClose: () => void
  t: typeof translations.en | typeof translations.zh
}) => {
  // Lock body scroll when modal is open
  useEffect(() => {
    if (show) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [show])

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative w-[90%] max-w-sm rounded-xl border border-white/10 bg-slate-900/80 p-4 shadow-[0_0_30px_rgba(59,130,246,0.4)] backdrop-blur-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
          <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
          <div className="relative space-y-3">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 shadow-[0_0_25px_rgba(99,102,241,0.7)]" />
              <p className="text-2xl font-bold text-white">{t.how_to_play}</p>
            </div>
            
            {/* Step 1: Fast Market */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <div className="text-xl shrink-0">⏱️</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-cyan-400 mb-1">{t.step1_title}</p>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {t.step1_desc.split('**').map((part, i) => 
                      i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
                    )}
        </p>
      </div>
              </div>
            </div>

            {/* Step 2: Smash to Boost */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <div className="text-xl shrink-0">🔥</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-red-400 mb-1">{t.step2_title}</p>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {t.step2_desc.split('**').map((part, i) => 
                      i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Step 3: Win Big */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <div className="text-xl shrink-0">💰</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-400 mb-1">{t.step3_title}</p>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {t.step3_desc.split('**').map((part, i) => 
                      i % 2 === 1 ? <strong key={i} className="text-white font-semibold">{part}</strong> : part
                    )}
                  </p>
                </div>
              </div>
            </div>

            {/* Step 4: Mine Coins */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <div className="text-xl shrink-0">⛏️</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-green-400 mb-1">{t.step4_title}</p>
                  <p className="text-xs text-slate-300 leading-relaxed">
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
              className="w-full rounded-xl bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600 px-3 py-2 text-base font-bold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)] active:scale-95 transition-all"
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
  const statusLabel =
    gameState === 'RESULT'
      ? 'Match Finished'
      : gameState === 'BETTING'
      ? 'Match Starting'
      : null

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl">
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
              <p className="text-sm font-bold text-white relative z-0 drop-shadow-[0_0_8px_rgba(0,0,0,0.8)]">
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
                <p className="text-xl font-bold text-red-400 drop-shadow-[0_0_15px_rgba(239,68,68,0.8)] animate-pulse">
                  LIVE
                </p>
              </div>
            )}
            {gameState === 'LOCKED' && (
              <motion.div
                key={`${liveScore.home}-${liveScore.away}`}
                initial={{ scale: 1.2, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center mb-4"
              >
                <p className="text-4xl font-black text-white drop-shadow-[0_0_20px_rgba(251,191,36,0.8)]">
                  {liveScore.home} - {liveScore.away}
                </p>
              </motion.div>
            )}
            {gameState === 'RESULT' && matchResult && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="text-center mb-4"
              >
                <p className="text-4xl font-black text-white drop-shadow-[0_0_20px_rgba(251,191,36,0.8)]">
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
              <p className="text-sm font-bold text-white relative z-0 drop-shadow-[0_0_8px_rgba(0,0,0,0.8)]">
                {currentMatch.away}
              </p>
            </div>
            <div className="mt-2">
              <RecentForm form={currentMatch.awayForm} />
            </div>
          </div>
        </div>
      </div>

      {statusLabel && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/60 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md shadow-[0_0_20px_rgba(0,0,0,0.35)]">
            <span>{statusLabel}</span>
          </div>
        </div>
      )}
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

  // Lock body scroll when modal is open
  useEffect(() => {
    if (show) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [show])

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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative w-[90%] max-w-sm rounded-xl border border-white/10 bg-slate-900/90 p-4 shadow-[0_0_30px_rgba(59,130,246,0.4)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -inset-px rounded-xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
            <div className="relative space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-cyan-400 to-blue-600 shadow-[0_0_25px_rgba(59,130,246,0.7)] flex items-center justify-center text-lg">
                  ✈️
                </div>
                <div>
                  <p className="text-base font-bold text-white">Share Your Bet</p>
                  <p className="text-xs text-slate-300">Challenge your friends!</p>
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-slate-300 leading-relaxed">{shareText}</p>
              </div>
              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={handleCopy}
                  className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
                >
                  Copy Text
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={handleTelegramShare}
                  className="flex-1 rounded-lg bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-3 py-2 text-xs font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]"
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
          className={`text-4xl md:text-6xl font-black ${
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
  isMuted,
}: {
  onSmash: () => void
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
      {/* Smash Button */}
      <motion.button
        whileTap={{ scale: 0.9 }}
        onClick={handleSmash}
        className="relative w-full h-14 rounded-full bg-gradient-to-br from-red-500 via-red-600 to-red-700 shadow-[0_0_30px_rgba(239,68,68,0.6)] border-2 border-red-400/50 active:scale-95 active:shadow-[0_0_20px_rgba(239,68,68,0.4)] transition-all"
      >
        <motion.div
          animate={{
            boxShadow: [
              '0_0_30px_rgba(239,68,68,0.6)',
              '0_0_40px_rgba(239,68,68,0.8)',
              '0_0_30px_rgba(239,68,68,0.6)',
            ],
          }}
          transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute inset-0 rounded-full"
        />
        <span className="relative z-10 text-xl font-black text-white drop-shadow-[0_0_15px_rgba(0,0,0,0.8)]">
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
  // Lock body scroll when modal is open
  useEffect(() => {
    if (show) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [show])

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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18 }}
            className="relative w-[90%] max-w-sm rounded-xl border border-white/10 bg-slate-900/90 p-4 shadow-[0_0_30px_rgba(59,130,246,0.4)] backdrop-blur-2xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -inset-px rounded-xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
            <div className="relative space-y-3">
              {/* Main Result */}
              <div className="text-center">
                <div className="text-3xl mb-1.5">{isWin ? '🎉' : '😢'}</div>
                <p className={`text-xl font-bold ${isWin ? 'text-amber-400' : 'text-red-400'}`}>
                  {isWin ? 'YOU WON!' : 'YOU LOST'}
                </p>
                {isWin && (
                  <p className="text-base text-amber-300 mt-1.5 font-semibold">
                    +{profit.toLocaleString()} Coins 🪙
                  </p>
                )}
              </div>

              {/* AI Analysis Box - Only show on loss (Aggressive AI Mode) */}
              {!isWin && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 flex flex-col">
                  {/* Title Row */}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-red-400 text-base">🤖</span>
                    <p className="text-xs font-semibold text-red-300">AI Analysis</p>
                  </div>
                  {/* Prediction Info */}
                  <p className="text-[10px] text-slate-400 mb-2 leading-relaxed">
                    AI Model predicted: {result === 'HOME' ? currentMatch.home : result === 'DRAW' ? 'Draw' : currentMatch.away}
                  </p>
                  {/* Warning Message */}
                  <div className="flex items-start gap-2">
                    <span className="text-red-400 text-sm shrink-0">⚠️</span>
                    <p className="text-xs text-red-300 font-semibold leading-relaxed flex-1">
                      {(() => {
                        const messages = [
                          "The Banker loves your donation. 🤡",
                          "Betting with feelings? Rookie mistake.",
                          "Data saw this coming. You didn't.",
                        ]
                        return messages[Math.floor(Math.random() * messages.length)]
                      })()}
                    </p>
                  </div>
                </div>
              )}
              
              {/* Win Message - Aggressive Victory Mode */}
              {isWin && (
                <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-400 text-sm">💰</span>
                    <p className="text-xs font-semibold text-green-300">Victory Analysis</p>
                  </div>
                  {(() => {
                    const messages = [
                      "You robbed the Banker! 💰",
                      "Systems Analysis: CORRECT. Good execution.",
                      "Smart Money Move. Keep stacking.",
                    ]
                    return (
                      <p className="text-xs text-green-300 font-semibold">
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
                    className="w-full rounded-lg bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 px-3 py-2.5 text-base font-black text-white shadow-[0_0_30px_rgba(251,191,36,0.6)] active:scale-95 active:shadow-[0_0_20px_rgba(251,191,36,0.4)] transition-all"
                  >
                    💰 CLAIM {profit.toLocaleString()} COINS
                  </motion.button>
                ) : (
                  <>
                    <motion.button
                      whileTap={{ scale: 0.96 }}
                      onClick={onClose}
                      className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 transition"
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
                      className="flex-1 rounded-lg bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]"
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

// AI Analysis Modal (shown after paying / or when already unlocked this round)
const AnalysisModal = ({
  show,
  onClose,
  onJoinVip,
  teamHint,
}: {
  show: boolean
  onClose: () => void
  onJoinVip: () => void
  teamHint: string
}) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.92, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="relative w-[90%] max-w-sm rounded-xl border border-white/10 bg-slate-900/85 p-4 shadow-[0_0_30px_rgba(59,130,246,0.35)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -inset-px rounded-xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />
            <div className="relative space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🧠</span>
                <p className="text-lg font-black text-white">AI Analysis</p>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                <p className="text-sm font-bold text-amber-200">
                  🎯 OddsFlow Prediction: Total Goals Over 2.5 (85% Confidence). Recommended Bet: High Volatility.
                </p>
                <p className="text-[10px] text-slate-400 mt-1">
                  Match hint: <span className="text-cyan-300 font-semibold">{teamHint}</span>
                </p>
              </div>

              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={onJoinVip}
                  className="flex-1 rounded-lg bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-3 py-2 text-sm font-bold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]"
                >
                  Join VIP Channel
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 transition"
                >
                  Close
                </motion.button>
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
              className="text-2xl md:text-3xl font-black text-white tracking-wider"
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
          className="fixed inset-0 z-[9999] w-full h-full flex items-center justify-center bg-slate-900/80 backdrop-blur-md cursor-pointer"
          onClick={onTap}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="text-center"
          >
            <motion.div
              className="inline-flex flex-col items-center gap-4 bg-cyan-500/20 border-2 border-cyan-400 px-8 py-4 rounded-full shadow-[0_0_20px_rgba(6,182,212,0.5)]"
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
              <p className="text-2xl md:text-3xl font-bold text-white drop-shadow-lg">
                TAP ANYWHERE TO START GAME 🔊
              </p>
              <p className="text-base text-cyan-400 animate-pulse drop-shadow-md">
                Click to unlock audio
              </p>
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
    <div className="relative h-full overflow-y-auto rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl">
      {/* Top gradient mask */}
      <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-slate-900 via-slate-900/80 to-transparent z-10 pointer-events-none" />
      
      {/* Bottom gradient mask */}
      <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent z-10 pointer-events-none" />
      
      <div className="h-full overflow-y-auto">
        <div className="py-1">
          <AnimatePresence mode="popLayout">
            {activities.map((activity) => (
              <motion.div
                key={activity.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -20, scale: 0.95 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="px-3 py-1.5"
              >
                <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 backdrop-blur-md shadow-[0_0_15px_rgba(59,130,246,0.2)] hover:shadow-[0_0_20px_rgba(59,130,246,0.3)] transition-shadow">
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
      className="rounded-xl border-2 border-yellow-500/30 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 p-3 shadow-[0_0_40px_rgba(234,179,8,0.2)] backdrop-blur-xl"
    >
      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2">
        COMMUNITY TOTAL WON
      </p>
      <motion.div
        key={totalWon}
        initial={{ scale: 1.05 }}
        animate={{ scale: 1 }}
        className="flex items-center gap-2"
      >
        <span className="text-lg">⚠️</span>
        <span className="text-lg md:text-xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 drop-shadow-[0_0_20px_rgba(251,191,36,0.8)]">
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
  isAnalysisUnlocked,
  onUnlockAnalysis,
}: {
  type: 'SENTIMENT' | 'GREED' | 'AI_TEASER'
  userBet: { type: BetType | null; amount: number }
  currentMatch: Match
  onInviteClick: () => void
  isAnalysisUnlocked?: boolean
  onUnlockAnalysis?: () => void
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
        className="rounded-xl border-2 border-cyan-500/30 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 p-3 shadow-[0_0_30px_rgba(6,182,212,0.3)] backdrop-blur-xl"
      >
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-lg">📊</span>
          <p className="text-sm font-bold text-cyan-300">LIVE MARKET VOLUME</p>
        </div>
        
        <div className="space-y-2 mb-3">
          {/* Home Volume */}
          <div>
            <div className="flex justify-between text-xs mb-0.5">
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
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-slate-300">Draw</span>
              <span className="text-amber-300 font-semibold">{drawPercent}%</span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
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
            <div className="flex justify-between text-xs mb-0.5">
              <span className="text-slate-300">Away</span>
              <span className="text-purple-300 font-semibold">{awayPercent}%</span>
            </div>
            <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
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
          <p className="text-xs text-green-400 font-semibold mb-1.5">
            ⚠️ Contrarian Bet detected! Smart money is with you.
          </p>
        )}
        {isHeavy && (
          <p className="text-xs text-red-400 font-semibold mb-1.5">
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
        className="rounded-xl border-2 border-yellow-500/30 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 p-3 shadow-[0_0_30px_rgba(251,191,36,0.3)] backdrop-blur-xl"
      >
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-lg">💰</span>
          <p className="text-sm font-bold text-yellow-300">PROFIT OPPORTUNITY</p>
        </div>
        
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-2">
            <p className="text-[10px] text-slate-400 mb-0.5">Potential Win</p>
            <p className="text-sm font-semibold text-slate-300">
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
            className="rounded-lg border-2 border-yellow-400/50 bg-gradient-to-br from-yellow-500/20 to-amber-500/20 p-2"
          >
            <p className="text-[10px] text-yellow-300 mb-0.5">Invite Reward</p>
            <p className="text-lg font-black text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-amber-300 to-yellow-300">
              +500 Coins
            </p>
          </motion.div>
        </div>
        
        <motion.button
          whileTap={{ scale: 0.96 }}
          onClick={onInviteClick}
          className="w-full rounded-lg bg-gradient-to-r from-green-400 via-emerald-500 to-green-600 px-3 py-2 text-sm font-bold text-white shadow-[0_0_20px_rgba(34,197,94,0.4)]"
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
      className="rounded-xl border-2 border-blue-500/30 bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-slate-900/90 p-3 shadow-[0_0_30px_rgba(59,130,246,0.3)] backdrop-blur-xl"
    >
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-lg">🤖</span>
        <p className="text-sm font-bold text-blue-300">AI MODEL ALERT</p>
      </div>

      {/* Clean teaser text (no garbled repeat) */}
      <div className="rounded-lg border border-white/10 bg-slate-950/60 p-3 mb-3 shadow-[inset_0_0_30px_rgba(59,130,246,0.12)]">
        <p className="text-xs text-slate-200">
          🤖 AI Model detected a significant odds divergence for this match.
        </p>
        <p className="text-[10px] text-slate-400 mt-1">
          High confidence signal available.
        </p>
      </div>
      
      <motion.button
        whileTap={{ scale: 0.96 }}
        onClick={() => {
          if (isAnalysisUnlocked) {
            onUnlockAnalysis?.()
            return
          }
          onUnlockAnalysis?.()
        }}
        className="w-full rounded-lg border-2 border-blue-400/50 bg-gradient-to-r from-blue-500/20 to-indigo-500/20 px-3 py-2 text-sm font-bold text-blue-300 shadow-[0_0_20px_rgba(59,130,246,0.4)] flex items-center justify-center gap-1.5"
      >
        <span>🔓</span>
        <span>{isAnalysisUnlocked ? 'View Analysis' : `Unlock Analysis (${AI_ANALYSIS_COST} 💰)`}</span>
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
const BETTING_TIME = 25 // seconds - Phase 1: Betting period
const LOCKED_TIME = 25  // seconds - Phase 2: Match period (script playback)
const RESULT_TIME = 5   // seconds - Phase 3: Result period
const TOTAL_CYCLE = BETTING_TIME + LOCKED_TIME + RESULT_TIME // total cycle length

// Economy constants
const AI_ANALYSIS_COST = 500

function App() {
  // User state (Supabase connected)
  const [userId, setUserId] = useState<number | null>(null)
  const [firstName, setFirstName] = useState<string | null>(null)
  const [isUserLoaded, setIsUserLoaded] = useState(false)
  
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
  const [showJoinTaskModal, setShowJoinTaskModal] = useState(false)
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
  // AI Analysis unlock (per round)
  const [isAnalysisUnlocked, setIsAnalysisUnlocked] = useState(false)
  const [showAnalysisModal, setShowAnalysisModal] = useState(false)
  const [showNotEnoughCoinsModal, setShowNotEnoughCoinsModal] = useState(false)
  // Match Script Engine - timeline events for match period
  const [matchScript, setMatchScript] = useState<Array<{ time: number; type: 'goal' | 'whistle_start' | 'whistle_end'; team: 'home' | 'away' | null }>>([])
  const [liveScore, setLiveScore] = useState<{ home: number; away: number }>({ home: 0, away: 0 })
  const [showGoalFlash, setShowGoalFlash] = useState(false)
  // Floating text animation for bet feedback
  const [floatingTexts, setFloatingTexts] = useState<Array<{ id: number; text: string; x: number; y: number }>>([])
  // Wallet icon animation state (used for claim animation)
  const [walletPulse, setWalletPulse] = useState(false)

  const t = translations[lang]

  // Telegram WebApp - Force fullscreen and ready state
  useEffect(() => {
    if (window.Telegram?.WebApp) {
      // 1. 告诉 Telegram 展开全屏 (不再是半屏)
      window.Telegram.WebApp.expand()
      // 2. 告诉 Telegram 应用已准备好 (消除加载白屏)
      window.Telegram.WebApp.ready()
      // 3. 强制设置标题栏颜色为深色，与背景融合
      window.Telegram.WebApp.setHeaderColor('#0f172a') // 使用你的背景色 slate-900
    }
  }, [])

  // Supabase: Auto Login/Register User
  useEffect(() => {
    const initializeUser = async () => {
      try {
        let telegramUserId: number | null = null
        let telegramFirstName: string | null = null
        let inviterId: number | null = null

        // Detect Telegram user
        if (window.Telegram?.WebApp?.initDataUnsafe?.user) {
          const tgUser = window.Telegram.WebApp.initDataUnsafe.user
          telegramUserId = tgUser.id
          telegramFirstName = tgUser.first_name || null

          // Referral: read inviter id from start_param (Telegram passes it via initDataUnsafe.start_param)
          const startParam = window.Telegram.WebApp.initDataUnsafe?.start_param
          if (typeof startParam === 'string' && /^\d+$/.test(startParam)) {
            inviterId = Number(startParam)
            if (Number.isNaN(inviterId)) inviterId = null
          }
        } else {
          // Fallback for local development (non-Telegram environment)
          // IMPORTANT: Use a per-browser stable id to avoid "everyone shares the same wallet" during dev.
          const devKey = 'dev_telegram_id'
          const stored = localStorage.getItem(devKey)
          telegramUserId = stored ? Number(stored) : null
          if (!telegramUserId || Number.isNaN(telegramUserId)) {
            telegramUserId = Math.floor(Date.now() + Math.random() * 100000)
            localStorage.setItem(devKey, String(telegramUserId))
          }
          telegramFirstName = 'Dev'
          console.log('⚠️ Running in non-Telegram environment, using dev user:', telegramUserId)
        }

        if (!telegramUserId) {
          console.error('❌ No user ID found')
          setIsUserLoaded(true)
          return
        }

        setUserId(telegramUserId)
        setFirstName(telegramFirstName)

        // Query database for existing user
        const { data: existingUser, error: queryError } = await supabase
          .from('users')
          .select('telegram_id, coins, first_name')
          .eq('telegram_id', telegramUserId)
          .single()

        if (queryError && queryError.code !== 'PGRST116') {
          // PGRST116 = no rows returned, which is expected for new users
          console.error('❌ Error querying user:', queryError)
          setIsUserLoaded(true)
          return
        }

        if (existingUser) {
          // Existing user: load their data
          console.log('✅ Existing user found:', existingUser)
          setCoins(Number(existingUser.coins) || 1000)
          // Prefer DB name if present, otherwise keep Telegram-provided fallback
          setFirstName(existingUser.first_name || telegramFirstName)
        } else {
          // New user: create record
          console.log('🆕 Creating new user...')

          // Referral rules:
          // - If user opens app with start_param (inviter id) AND this is a new user insert:
          //   - Set invited_by = inviterId
          //   - New user initial coins = 2000 (otherwise 1000)
          //   - Reward inviter +500 coins
          const hasValidInviter =
            typeof inviterId === 'number' &&
            !Number.isNaN(inviterId) &&
            inviterId > 0 &&
            inviterId !== telegramUserId
          const initialCoins = hasValidInviter ? 2000 : 1000

          // Prefer atomic RPC so insert+reward is guaranteed as one transaction.
          const { data: rpcData, error: rpcError } = await supabase.rpc('register_user_with_referral', {
            p_telegram_id: telegramUserId,
            p_first_name: telegramFirstName,
            p_inviter_id: hasValidInviter ? inviterId : null,
          })

          const rpcRow = Array.isArray(rpcData) ? rpcData[0] : rpcData

          // If RPC exists and succeeded, use it.
          if (!rpcError && rpcRow) {
            console.log('✅ New user created via RPC:', rpcRow)
            setCoins(Number(rpcRow.coins) || initialCoins)
            setFirstName(rpcRow.first_name || telegramFirstName)
            setIsUserLoaded(true)
            return
          }

          // RPC fallback (non-atomic): keep compatibility if you haven't created the function yet.
          if (rpcError) {
            console.warn('⚠️ RPC register_user_with_referral failed; falling back to client-side flow:', rpcError)
          }

          const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert({
              telegram_id: telegramUserId,
              first_name: telegramFirstName,
              coins: initialCoins,
              invited_by: hasValidInviter ? inviterId : null,
              invited_rewarded: hasValidInviter ? true : false,
            })
            .select()
            .single()

          if (insertError) {
            console.error('❌ Error creating user:', insertError)
            // Fallback to default values
            setCoins(initialCoins)
          } else {
            console.log('✅ New user created:', newUser)
            setCoins(Number(newUser.coins) || initialCoins)
            setFirstName(newUser.first_name || telegramFirstName)

            // Reward inviter (+500 coins) if applicable
            if (hasValidInviter && inviterId) {
              try {
                // Best-effort fallback reward (may be non-atomic).
                const { data: inviter, error: inviterFetchError } = await supabase
                  .from('users')
                  .select('coins')
                  .eq('telegram_id', inviterId)
                  .single()

                if (inviterFetchError) {
                  console.error('❌ Error fetching inviter:', inviterFetchError)
                } else {
                  const inviterCoins = Number(inviter?.coins) || 0
                  const { error: inviterUpdateError } = await supabase
                    .from('users')
                    .update({ coins: inviterCoins + 500 })
                    .eq('telegram_id', inviterId)

                  if (inviterUpdateError) {
                    console.error('❌ Error rewarding inviter:', inviterUpdateError)
                  } else {
                    console.log('✅ Inviter rewarded +500 coins:', inviterId)
                  }
                }
              } catch (e) {
                console.error('❌ Unexpected error rewarding inviter:', e)
              }
            }
          }
        }

        setIsUserLoaded(true)
      } catch (error) {
        console.error('❌ Unexpected error during user initialization:', error)
        setIsUserLoaded(true)
      }
    }

    initializeUser()
  }, [])
  
  // Log user info when loaded (using variables to avoid unused warnings)
  useEffect(() => {
    if (isUserLoaded && userId) {
      console.log(
        `👤 User loaded: ${firstName || 'Unknown'} (telegram_id: ${userId})`,
      )
    }
  }, [isUserLoaded, userId, firstName])

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

  // Game loop engine - cycle (BETTING_TIME betting -> LOCKED_TIME locked -> RESULT_TIME result)
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft((prevTime) => {
        const newTime = prevTime - 1

        // Last 3 seconds of betting phase - red flash + vibration
        // (Betting phase is BETTING_TIME seconds; global timeLeft includes locked+result too.)
        const bettingLeft = newTime - (LOCKED_TIME + RESULT_TIME)
        if (bettingLeft <= 3 && bettingLeft > 0 && gameState === 'BETTING') {
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

        // Transition to LOCKED at end of betting phase (BETTING_TIME seconds)
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
              // WIN: Don't update coins here - wait for CLAIM button click
              // Coins will be added when user clicks CLAIM button
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
          setIsAnalysisUnlocked(false) // Reset AI analysis unlock per round
          setShowAnalysisModal(false)
          setMatchScript([]) // Clear match script
          setLiveScore({ home: 0, away: 0 }) // Reset live score
          setShowGoalFlash(false) // Reset goal flash
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

  const openVipChannel = () => {
    const vipUrl = 'https://t.me/oddsflowvip'
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(vipUrl)
    } else {
      window.open(vipUrl, '_blank')
    }
  }

  const handleJoinTaskSuccess = () => {
    // Play win sound + confetti
    if (winRef.current && !isMuted) {
      winRef.current.currentTime = 0
      winRef.current.play().catch(() => {})
    }

    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      colors: ['#FFD700', '#FFA500', '#34D399', '#60A5FA'],
    })

    setWalletPulse(true)
    setTimeout(() => setWalletPulse(false), 500)

    setShowJoinTaskModal(false)
  }

  const handleInviteShare = () => {
    if (!userId) return

    // Build Telegram share URL (per your required formula):
    // https://t.me/share/url?url=encodeURIComponent(https://t.me/Oddsflow_minigame_bot/Miniapp?startapp=${currentUserId})
    // &text=encodeURIComponent(🎁 送你 2000 金币！快来 Oddsflow 预测比赛赢大奖！)
    const appBase = 'https://t.me/Oddsflow_minigame_bot/Miniapp'
    const deepLink = `${appBase}?startapp=${userId}`
    const text = '🎁 送你 2000 金币！快来 Oddsflow 预测比赛赢大奖！'
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(deepLink)}&text=${encodeURIComponent(text)}`

    // Prefer Telegram native open method inside Mini App
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl)
    } else {
      window.open(shareUrl, '_blank')
    }
  }

  const handleUnlockAnalysis = async () => {
    // If already unlocked this round, just view it
    if (isAnalysisUnlocked) {
      setShowAnalysisModal(true)
      return
    }

    // Quick local check
    if (coins < AI_ANALYSIS_COST) {
      setShowNotEnoughCoinsModal(true)
      return
    }

    if (!userId) return

    try {
      // Check latest coins from DB for safety (avoid multi-session desync)
      const { data: currentUser, error: fetchError } = await supabase
        .from('users')
        .select('coins')
        .eq('telegram_id', userId)
        .single()

      if (fetchError) {
        console.error('❌ Error fetching coins for analysis unlock:', fetchError)
        return
      }

      const dbCoins = typeof currentUser?.coins === 'string' ? Number(currentUser.coins) : (currentUser?.coins ?? 0)
      if (!Number.isFinite(dbCoins) || dbCoins < AI_ANALYSIS_COST) {
        setShowNotEnoughCoinsModal(true)
        return
      }

      const newCoins = dbCoins - AI_ANALYSIS_COST

      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({ coins: newCoins })
        .eq('telegram_id', userId)
        .select('coins')
        .single()

      if (updateError) {
        console.error('❌ Error deducting coins for analysis unlock:', updateError)
        return
      }

      // Sync local wallet and unlock state
      const nextCoins =
        typeof updatedUser?.coins === 'string' ? Number(updatedUser.coins) : (updatedUser?.coins ?? newCoins)
      setCoins(Number.isFinite(nextCoins) ? nextCoins : newCoins)
      setIsAnalysisUnlocked(true)
      setShowAnalysisModal(true)
    } catch (e) {
      console.error('❌ Unexpected error unlocking analysis:', e)
    }
  }

  const handlePlaceBet = async (type: BetType, event?: React.MouseEvent<HTMLButtonElement>) => {
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
    
    // Update local state immediately (optimistic update)
    setCoins((prev) => prev - betAmount)
    setUserBet({ type, amount: betAmount })
    
    // Sync to Supabase database
    if (userId) {
      try {
        // Always scope updates to the CURRENT Telegram user
        const { data: currentUser, error: fetchError } = await supabase
          .from('users')
          .select('coins')
          .eq('telegram_id', userId)
          .single()

        if (fetchError) {
          console.error('❌ Error fetching current coins:', fetchError)
          setCoins((prev) => prev + betAmount) // rollback
          return
        }

        const dbCoins = currentUser?.coins ?? 0
        const newCoins = dbCoins - betAmount
        if (newCoins < 0) {
          // DB says insufficient funds (could happen if user has multiple sessions)
          setCoins((prev) => prev + betAmount) // rollback
          setShowReviveModal(true)
          return
        }

        const { data: updatedUser, error } = await supabase
          .from('users')
          .update({ coins: newCoins })
          .eq('telegram_id', userId)
          .select()
          .single()

        if (error) {
          console.error('❌ Error updating coins in database:', error)
          // Rollback local state on error
          setCoins((prev) => prev + betAmount)
        } else {
          console.log('✅ Coins deducted in database:', updatedUser)
          // Sync local state with database value (in case of race conditions)
          if (updatedUser) {
            setCoins(updatedUser.coins)
          }
        }
      } catch (error) {
        console.error('❌ Unexpected error updating coins:', error)
        // Rollback local state on error
        setCoins((prev) => prev + betAmount)
      }
    }
    
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

  const handleInviteForRewards = async () => {
    const rewardAmount = 500
    
    // Update local state immediately (optimistic update)
    setCoins((prev) => prev + rewardAmount)
    setShowReviveModal(false)
    
    // Sync to Supabase database
    if (userId) {
      try {
        // First, get current coins from database to ensure accuracy
        const { data: currentUser, error: fetchError } = await supabase
          .from('users')
          .select('coins')
          .eq('telegram_id', userId)
          .single()

        if (fetchError) {
          console.error('❌ Error fetching current coins:', fetchError)
          // Rollback local state on error
          setCoins((prev) => prev - rewardAmount)
          return
        }

        const newCoins = (currentUser?.coins || 0) + rewardAmount

        // Update database with new coins
        const { data: updatedUser, error } = await supabase
          .from('users')
          .update({ coins: newCoins })
          .eq('telegram_id', userId)
          .select()
          .single()

        if (error) {
          console.error('❌ Error updating coins in database:', error)
          // Rollback local state on error
          setCoins((prev) => prev - rewardAmount)
        } else {
          console.log('✅ Invite reward coins added to database:', updatedUser)
          // Sync local state with database value (in case of race conditions)
          if (updatedUser) {
            setCoins(updatedUser.coins)
          }
        }
      } catch (error) {
        console.error('❌ Unexpected error adding invite reward:', error)
        // Rollback local state on error
        setCoins((prev) => prev - rewardAmount)
      }
    }
  }

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  // Phase-based countdown (so BETTING window shows 25s, not the full cycle)
  const getPhaseDuration = () => {
    if (gameState === 'BETTING') return BETTING_TIME
    if (gameState === 'LOCKED') return LOCKED_TIME
    return RESULT_TIME
  }

  const getPhaseTimeLeft = () => {
    if (gameState === 'BETTING') return Math.max(0, timeLeft - (LOCKED_TIME + RESULT_TIME))
    if (gameState === 'LOCKED') return Math.max(0, timeLeft - RESULT_TIME)
    return Math.max(0, timeLeft)
  }

  return (
    <div className={`relative h-screen w-screen overflow-hidden flex flex-col bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-slate-100 ${
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

      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col min-h-0 gap-1.5 px-4 pt-4 pb-3 overflow-hidden">
        {/* Top bar - Fixed Header */}
        <div className="flex-none flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 shadow-[0_0_20px_rgba(59,130,246,0.35)] backdrop-blur-lg">
          <div className="flex items-center gap-3">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                playSfx('click')
                setShowLeaderboardModal(true)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] transition hover:bg-white/20 focus:outline-none"
            >
              <Trophy className="h-4 w-4" />
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => {
                playSfx('click')
                setShowRulesModal(true)
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] transition hover:bg-white/20 focus:outline-none"
            >
              <Info className="h-4 w-4" />
            </motion.button>
            <div className="flex flex-col min-w-0">
              <p className="text-[10px] uppercase tracking-[0.15em] text-cyan-400">
                LIVE PREDICTION MARKET
              </p>
              <div className="flex items-center gap-1 flex-wrap">
                <p className="text-sm font-bold text-slate-100 whitespace-nowrap">
                  OddsFlow
                </p>
                <span className="text-[8px] font-bold bg-black text-amber-400 px-1 py-0.5 rounded leading-tight shrink-0">
                  AI
                </span>
                <p className="text-sm font-bold text-slate-100 whitespace-nowrap">
                  Exchange
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3 min-w-0">
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleLang}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] transition hover:bg-white/20 focus:outline-none text-[10px] font-bold"
            >
              {lang === 'en' ? '中' : 'EN'}
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={toggleMute}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-[0_0_15px_rgba(59,130,246,0.4)] transition hover:bg-white/20 focus:outline-none"
            >
              {isMuted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </motion.button>

            {/* User info (name + coins) pinned to top-right */}
            <div className="flex flex-col items-end gap-0.5 min-w-0">
              <div className="max-w-[100px] min-w-0 truncate text-[10px] font-medium text-gray-300">
                Hi, {firstName || '...'}
              </div>
              <motion.div
                animate={walletPulse ? { scale: [1, 1.5, 1] } : {}}
                transition={{ duration: 0.5, ease: 'easeOut' }}
                className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-100 shadow-[0_0_15px_rgba(251,191,36,0.45)]"
              >
                <span className="text-sm">🪙</span>
                <span className="text-white font-bold text-xs">{coins.toLocaleString()}</span>
              </motion.div>
            </div>
          </div>
        </div>

        {/* Countdown Timer - Fixed */}
        <div className="flex-none rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 shadow-[0_0_20px_rgba(59,130,246,0.35)] backdrop-blur-lg">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-[0.15em] text-cyan-400">
              {gameState === 'BETTING' ? 'BETTING OPEN' : gameState === 'LOCKED' ? 'MATCH IN PROGRESS' : 'RESULT'}
            </span>
            <span className={`text-sm font-bold ${
              gameState === 'BETTING' ? 'text-green-400' : 
              gameState === 'LOCKED' ? 'text-red-400' : 
              'text-amber-400'
            }`}>
              {formatTime(getPhaseTimeLeft())}
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
              animate={{ width: `${(getPhaseTimeLeft() / getPhaseDuration()) * 100}%` }}
              transition={{ duration: 1, ease: 'linear' }}
            />
          </div>
        </div>

        {/* Main Content (takes remaining space, internal scroll only) */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
          {/* Join Channel Task Entry */}
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowJoinTaskModal(true)}
            className="w-full rounded-xl bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 px-3 py-2 text-sm font-black text-white shadow-[0_0_18px_rgba(251,191,36,0.45)]"
          >
            💰 +1000 Free Coins
          </motion.button>

        {/* Immersive Holographic Stadium with Layered Layout - Responsive Height */}
        <div className="shrink-0 h-48 sm:h-[25vh] md:h-64">
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
        </div>

        {/* Active Bet Indicator - Fixed */}
        {userBet.type !== null && (
          <div className="flex-none flex items-center gap-1.5">
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex-1 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 backdrop-blur-sm"
            >
              {gameState === 'BETTING' && (
                <div className="flex items-center gap-1.5 text-cyan-300">
                  <span className="text-xs">✅</span>
                  <span className="font-semibold text-xs">
                    {t.you_bet} {userBet.amount} 🪙 {t.on} {userBet.type === 'home' ? t.home_win : userBet.type === 'draw' ? t.draw : t.away_win}
                  </span>
                </div>
              )}
              {gameState === 'RESULT' && betResult === 'win' && roundResult && (
                <div className="flex items-center gap-1.5 text-amber-300">
                  <span className="text-xs">🎉</span>
                  <span className="font-semibold text-xs">
                    WIN! +{roundResult.profit} {t.coins}
                  </span>
                </div>
              )}
              {gameState === 'RESULT' && betResult === 'lose' && (
                <div className="flex items-center gap-1.5 text-red-300">
                  <span className="text-xs">❌</span>
                  <span className="font-semibold text-xs">
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
                className="rounded-lg border border-cyan-400/30 bg-cyan-400/20 px-3 py-2 text-xs font-semibold text-cyan-300 shadow-[0_0_15px_rgba(34,211,238,0.4)] hover:bg-cyan-400/30 transition"
              >
                Share ✈️
              </motion.button>
            )}
          </div>
        )}

        {/* Betting Buttons - Fixed */}
        {gameState === 'BETTING' ? (
          <div className="flex-none grid grid-cols-3 gap-1.5">
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
              className={`rounded-xl border-2 p-3 text-center font-bold shadow-lg transition active:scale-95 active:opacity-80 ${
                userBet.type === 'home'
                  ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.5)]'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <p className="text-xs mb-0.5 opacity-80">Home Win</p>
              <div className="flex items-center justify-center gap-0.5 mb-1">
                <p className="text-lg">{currentMatch.odds.home}x</p>
                {currentMatch.oddsTrend.home && (
                  <span className={`text-sm font-bold ${
                    currentMatch.oddsTrend.home === 'up' ? 'text-red-500' : 'text-green-500'
                  }`}>
                    {currentMatch.oddsTrend.home === 'up' ? '↑' : '↓'}
                  </span>
                )}
              </div>
              {userBet.type === 'home' ? (
                <p className="text-[10px] text-cyan-300">Bet: {userBet.amount} 🪙</p>
              ) : (
                <p className="text-[10px] opacity-60">Bet: 100 🪙</p>
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
              className={`rounded-xl border-2 p-3 text-center font-bold shadow-lg transition active:scale-95 active:opacity-80 ${
                userBet.type === 'draw'
                  ? 'border-amber-400 bg-amber-400/20 text-amber-300 shadow-[0_0_20px_rgba(251,191,36,0.5)]'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <p className="text-xs mb-0.5 opacity-80">Draw</p>
              <div className="flex items-center justify-center gap-0.5 mb-1">
                <p className="text-lg">{currentMatch.odds.draw}x</p>
                {currentMatch.oddsTrend.draw && (
                  <span className={`text-sm font-bold ${
                    currentMatch.oddsTrend.draw === 'up' ? 'text-red-500' : 'text-green-500'
                  }`}>
                    {currentMatch.oddsTrend.draw === 'up' ? '↑' : '↓'}
                  </span>
                )}
              </div>
              {userBet.type === 'draw' ? (
                <p className="text-[10px] text-amber-300">Bet: {userBet.amount} 🪙</p>
              ) : (
                <p className="text-[10px] opacity-60">Bet: 100 🪙</p>
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
              className={`rounded-xl border-2 p-3 text-center font-bold shadow-lg transition active:scale-95 active:opacity-80 ${
                userBet.type === 'away'
                  ? 'border-purple-400 bg-purple-400/20 text-purple-300 shadow-[0_0_20px_rgba(168,85,247,0.5)]'
                  : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/30'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              <p className="text-xs mb-0.5 opacity-80">Away Win</p>
              <div className="flex items-center justify-center gap-0.5 mb-1">
                <p className="text-lg">{currentMatch.odds.away}x</p>
                {currentMatch.oddsTrend.away && (
                  <span className={`text-sm font-bold ${
                    currentMatch.oddsTrend.away === 'up' ? 'text-red-500' : 'text-green-500'
                  }`}>
                    {currentMatch.oddsTrend.away === 'up' ? '↑' : '↓'}
                  </span>
                )}
              </div>
              {userBet.type === 'away' ? (
                <p className="text-[10px] text-purple-300">Bet: {userBet.amount} 🪙</p>
              ) : (
                <p className="text-[10px] opacity-60">Bet: 100 🪙</p>
              )}
            </motion.button>
          </div>
        ) : gameState === 'LOCKED' ? (
          <div className="flex-none rounded-xl border border-white/20 bg-white/5 p-3 text-center backdrop-blur-xl">
            <p className="text-xs text-slate-300">Match in progress. SMASH is at the bottom 👇</p>
          </div>
        ) : (
          <div className="flex-none rounded-xl border border-white/20 bg-white/5 p-3 text-center backdrop-blur-xl">
            <p className="text-xs text-slate-400">Match finished. Next round starting...</p>
          </div>
        )}

        {/* Intel Board - Show after betting - Fixed */}
        {userBet.type !== null && intelType && gameState !== 'RESULT' && (
          <div className="flex-none">
            <AnimatePresence mode="wait">
              <IntelBoard
                key={intelType}
                type={intelType}
                userBet={userBet}
                currentMatch={currentMatch}
                onInviteClick={() => {
                  setShowShareModal(true)
                }}
                isAnalysisUnlocked={isAnalysisUnlocked}
                onUnlockAnalysis={handleUnlockAnalysis}
              />
            </AnimatePresence>
          </div>
        )}

        {/* Scrollable Content Area */}
        <div className="flex-none flex flex-col gap-2">
          {/* Live Activity Feed - Scrollable & Compact */}
          <div className="h-32 min-h-0 overflow-hidden">
            <ActivityFeed matchHistory={matchHistory} />
          </div>
          
          {/* Community Jackpot - Fixed at bottom */}
          <div className="flex-none">
            <CommunityJackpot />
          </div>
        </div>

        </div>

        {/* Footer (fixed to bottom): Invite + SMASH */}
        <div className="flex-none pb-2 pt-1">
          <div className="flex flex-col gap-1.5">
            {/* Compact Invite button (doesn't push SMASH off-screen) */}
            <motion.button
              whileTap={{ scale: 0.99 }}
              onClick={handleInviteShare}
              disabled={!userId}
              className="w-full rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-bold text-emerald-100 shadow-[0_0_12px_rgba(34,197,94,0.25)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Invite Friends (+500💰)
            </motion.button>

            {gameState === 'LOCKED' && (
              <SmashToBoost
                onSmash={() => {
                  // Trigger animation and vibration only
                }}
                isMuted={isMuted}
              />
            )}
          </div>
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

      <Modal
        show={showNotEnoughCoinsModal}
        onClose={() => setShowNotEnoughCoinsModal(false)}
        title="Not enough coins"
        description="Not enough coins! Win more to unlock."
        actionLabel="OK"
        actionColor="blue"
      />

      <ResultAnalysisModal
        show={showWinModal && roundResult !== null}
        onClose={handleResultModalClose}
        roundResult={roundResult}
        currentMatch={currentMatch}
        onClaim={async () => {
          // Trigger wallet icon animation
          setWalletPulse(true)
          setTimeout(() => setWalletPulse(false), 500)
          
          // Claim coins: Add to database and local state
          if (roundResult && roundResult.isWin && roundResult.profit > 0) {
            const profit = roundResult.profit
            
            // Update local state immediately (optimistic update)
            setCoins((prev) => prev + profit)
            
            // Sync to Supabase database
            if (userId) {
              try {
                // First, get current coins from database to ensure accuracy
                const { data: currentUser, error: fetchError } = await supabase
                  .from('users')
                  .select('coins')
                  .eq('telegram_id', userId)
                  .single()

                if (fetchError) {
                  console.error('❌ Error fetching current coins:', fetchError)
                  // Rollback local state on error
                  setCoins((prev) => prev - profit)
                  return
                }

                const newCoins = (currentUser?.coins || 0) + profit

                // Update database with new coins
                const { data: updatedUser, error } = await supabase
                  .from('users')
                  .update({ coins: newCoins })
                  .eq('telegram_id', userId)
                  .select()
                  .single()

                if (error) {
                  console.error('❌ Error updating coins in database:', error)
                  // Rollback local state on error
                  setCoins((prev) => prev - profit)
                } else {
                  console.log('✅ Coins claimed in database:', updatedUser)
                  // Sync local state with database value (in case of race conditions)
                  if (updatedUser) {
                    setCoins(updatedUser.coins)
                  }
                }
              } catch (error) {
                console.error('❌ Unexpected error claiming coins:', error)
                // Rollback local state on error
                setCoins((prev) => prev - profit)
              }
            }
          }
        }}
      />

      <AnalysisModal
        show={showAnalysisModal}
        onClose={() => setShowAnalysisModal(false)}
        onJoinVip={openVipChannel}
        teamHint={currentMatch.home}
      />

      <TaskModal
        show={showJoinTaskModal}
        onClose={() => setShowJoinTaskModal(false)}
        channelUrl="https://t.me/oddsflowvip"
        telegramId={userId}
        onCoinsUpdated={(next) => setCoins(next)}
        onRewardSuccess={handleJoinTaskSuccess}
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
        currentUser={{
          telegramId: userId,
          coins,
          firstName,
          username: null,
        }}
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
                className="text-5xl md:text-7xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500 drop-shadow-[0_0_40px_rgba(251,191,36,0.8)]"
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