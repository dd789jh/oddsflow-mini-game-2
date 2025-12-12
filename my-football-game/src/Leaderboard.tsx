import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from './supabaseClient'

export type LeaderboardTranslations = {
  top_winners: string
  coins: string
  got_it: string
}

type LeaderRow = {
  telegram_id: number | null
  coins: number | string | null
  first_name: string | null
  // Optional DB column (if exists)
  username?: unknown
}

export const LeaderboardModal = ({
  show,
  onClose,
  t,
  currentUser,
}: {
  show: boolean
  onClose: () => void
  t: LeaderboardTranslations
  currentUser: {
    telegramId: number | null
    coins: number
    firstName: string | null
    username?: string | null
  }
}) => {
  const [topRows, setTopRows] = useState<LeaderRow[]>([])
  const [myRank, setMyRank] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const top7 = useMemo(() => topRows.slice(0, 7), [topRows])

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

  useEffect(() => {
    if (!show) return

    let cancelled = false

    const load = async () => {
      setLoading(true)
      try {
        // Query A: Top 20 by coins
        let leaders: any[] | null = null
        {
          // Try selecting username if present; fallback if column doesn't exist
          const res = await supabase
            .from('users')
            .select('telegram_id, coins, first_name, username')
            .order('coins', { ascending: false })
            .limit(20)

          if (res.error) {
            const fallback = await supabase
              .from('users')
              .select('telegram_id, coins, first_name')
              .order('coins', { ascending: false })
              .limit(20)

            if (fallback.error) {
              console.error('❌ Failed to load leaderboard:', fallback.error)
              return
            }
            leaders = fallback.data
          } else {
            leaders = res.data
          }
        }

        // Query B: My rank (count users with coins > myCoins)
        let computedRank: number | null = null
        if (typeof currentUser.coins === 'number' && Number.isFinite(currentUser.coins)) {
          const { count, error } = await supabase
            .from('users')
            .select('telegram_id', { count: 'exact', head: true })
            .gt('coins', currentUser.coins)

          if (error) {
            console.error('❌ Failed to compute my rank:', error)
          } else {
            computedRank = (count ?? 0) + 1
          }
        }

        if (!cancelled) {
          setTopRows((leaders || []) as LeaderRow[])
          setMyRank(computedRank)
        }
      } catch (e) {
        console.error('❌ Unexpected error loading leaderboard:', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [show, currentUser.coins])

  const getDisplayName = (row: { first_name?: string | null; username?: unknown } | null | undefined) => {
    const rawUsername = (row as any)?.username
    const username = typeof rawUsername === 'string' ? rawUsername.trim().replace(/^@/, '') : ''
    if (username) return `@${username}`
    const firstName = row?.first_name?.trim() || ''
    return firstName || 'Anonymous'
  }

  const myDisplayName = useMemo(() => {
    const username = currentUser.username?.trim().replace(/^@/, '') || ''
    if (username) return `@${username}`
    return currentUser.firstName?.trim() || 'Anonymous'
  }, [currentUser.firstName, currentUser.username])

  const myCoins = Number.isFinite(currentUser.coins) ? currentUser.coins : 0

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

            {/* Header */}
            <div className="relative space-y-3 flex-none">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 shadow-[0_0_25px_rgba(251,191,36,0.7)]" />
                <p className="text-xl font-bold text-white">{t.top_winners}</p>
                {loading && <span className="text-xs text-slate-400">Loading...</span>}
              </div>
            </div>

            {/* Scrollable list (Top 7) */}
            <div className="relative flex-1 min-h-0 overflow-y-auto mt-3">
              <div className="space-y-2">
                {top7.map((row, idx) => {
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

                  const coinsNum =
                    typeof row.coins === 'number'
                      ? row.coins
                      : typeof row.coins === 'string'
                        ? Number(row.coins)
                        : 0

                  const isMe = !!currentUser.telegramId && row.telegram_id === currentUser.telegramId

                  return (
                    <div
                      key={row.telegram_id ?? idx}
                      className={`flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3 ${
                        rank <= 3
                          ? `bg-gradient-to-r ${color} text-white shadow-[0_0_20px_rgba(251,191,36,0.4)]`
                          : 'text-slate-300'
                      } ${isMe ? 'ring-2 ring-emerald-400/60' : ''}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-lg">{medal}</span>
                        <span className="text-sm font-bold truncate">{getDisplayName(row)}</span>
                      </div>
                      <div className="text-sm font-semibold shrink-0">
                        {Number.isFinite(coinsNum) ? coinsNum.toLocaleString() : '0'} {t.coins}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Sticky footer: My rank */}
            <div className="flex-none mt-3 rounded-lg border border-white/10 bg-slate-950/60 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-500 flex items-center justify-center text-xs font-black text-slate-900 shadow-[0_0_18px_rgba(34,197,94,0.35)]">
                    {myDisplayName?.replace(/^@/, '').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white truncate">{myDisplayName}</div>
                    <div className="text-[10px] text-slate-400">
                      My Rank: #{myRank ?? '--'}
                    </div>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="text-[10px] text-slate-400">Coins</div>
                  <div className="text-sm font-bold text-amber-200">{myCoins.toLocaleString()}</div>
                </div>
              </div>
            </div>

            <motion.button
              whileTap={{ scale: 0.96 }}
              onClick={onClose}
              className="relative mt-3 w-full rounded-xl bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-600 px-3 py-2 text-sm font-bold text-white shadow-[0_0_20px_rgba(59,130,246,0.4)]"
            >
              {t.got_it}
            </motion.button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
