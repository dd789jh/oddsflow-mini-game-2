import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from './supabaseClient'

type Translations = {
  top_winners: string
  got_it: string
  coins: string
}

type LeaderRow = {
  telegram_id: number | null
  coins: number | string | null
  first_name: string | null
  // Optional column (some DBs have it, some don't)
  username?: unknown
}

function formatDisplayName(row: LeaderRow): string {
  const rawUsername = (row as any)?.username
  const username = typeof rawUsername === 'string' ? rawUsername.trim().replace(/^@/, '') : ''
  if (username) return `@${username}`
  if (row.first_name && row.first_name.trim()) return row.first_name.trim()
  return 'Anonymous'
}

function toCoinsNumber(coins: LeaderRow['coins']): number {
  if (typeof coins === 'number') return coins
  if (typeof coins === 'string') {
    const n = Number(coins)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export const LeaderboardModal = ({
  show,
  onClose,
  t,
  currentTelegramId,
  currentCoins,
  currentFirstName,
}: {
  show: boolean
  onClose: () => void
  t: Translations
  currentTelegramId: number | null
  currentCoins: number
  currentFirstName: string | null
}) => {
  const [leaderboardData, setLeaderboardData] = useState<LeaderRow[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)

  const myDisplayName = useMemo(() => {
    if (currentFirstName && currentFirstName.trim()) return currentFirstName.trim()
    return 'Anonymous'
  }, [currentFirstName])

  const myInitial = useMemo(() => {
    const name = myDisplayName
    return name.length ? name.slice(0, 1).toUpperCase() : '?'
  }, [myDisplayName])

  // Load leaderboard + compute my rank
  useEffect(() => {
    if (!show) return
    if (!currentTelegramId) return
    let cancelled = false

    const load = async () => {
      try {
        // Query A: top 20 by coins desc
        const { data: top20, error: topErr } = await supabase
          .from('users')
          .select('telegram_id, coins, first_name, username')
          .order('coins', { ascending: false })
          .limit(20)

        if (topErr) {
          console.error('❌ Failed to load leaderboard:', topErr)
        } else if (!cancelled) {
          setLeaderboardData((top20 as any) || [])
        }

        // Query B: my rank = count(coins > myCoins) + 1
        const { count, error: countErr } = await supabase
          .from('users')
          .select('telegram_id', { count: 'exact', head: true })
          .gt('coins', currentCoins)

        if (countErr) {
          console.error('❌ Failed to compute my rank:', countErr)
        } else if (!cancelled) {
          setMyRank((count ?? 0) + 1)
        }
      } catch (e) {
        console.error('❌ Unexpected leaderboard error:', e)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [show, currentTelegramId, currentCoins])

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
            className="relative w-[90%] max-w-sm rounded-xl border border-white/10 bg-slate-900/80 p-4 shadow-[0_0_30px_rgba(59,130,246,0.4)] backdrop-blur-2xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -inset-px rounded-xl bg-gradient-to-br from-white/10 via-transparent to-blue-500/20 blur-xl" />

            <div className="relative space-y-3 flex flex-col min-h-0">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 shadow-[0_0_25px_rgba(251,191,36,0.7)]" />
                <p className="text-xl font-bold text-white">{t.top_winners}</p>
              </div>

              {/* Scrollable list */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                {leaderboardData.map((row, idx) => {
                  const rank = idx + 1
                  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : ''
                  const color =
                    rank === 1
                      ? 'from-yellow-400 to-amber-500'
                      : rank === 2
                        ? 'from-slate-300 to-slate-400'
                        : rank === 3
                          ? 'from-amber-600 to-amber-700'
                          : ''

                  const displayName = formatDisplayName(row)
                  const coinsNum = toCoinsNumber(row.coins)
                  const isMe = !!currentTelegramId && row.telegram_id === currentTelegramId

                  return (
                    <div
                      key={row.telegram_id ?? idx}
                      className={`flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3 ${
                        rank <= 3
                          ? `bg-gradient-to-r ${color} text-white shadow-[0_0_20px_rgba(251,191,36,0.4)]`
                          : isMe
                            ? 'text-slate-100 border-cyan-400/40 bg-cyan-400/10'
                            : 'text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg">{medal}</span>
                        <span className="text-sm font-bold truncate">{displayName}</span>
                      </div>
                      <div className="text-sm font-semibold">
                        {coinsNum.toLocaleString()} {t.coins}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Sticky footer: My rank */}
              <div className="sticky bottom-0 -mx-4 mt-2 border-t border-white/10 bg-slate-800/70 px-4 py-3 backdrop-blur-xl">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-full bg-white/10 border border-white/15 flex items-center justify-center text-sm font-black text-white">
                      {myInitial}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">{myDisplayName}</div>
                      <div className="text-[11px] text-slate-300">
                        My Rank: #{myRank ?? '...'} · Coins: {currentCoins.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={onClose}
                className="w-full rounded-xl bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600 px-3 py-2 text-sm font-bold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]"
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

