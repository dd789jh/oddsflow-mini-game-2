import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { supabase } from './supabaseClient'

export function TaskModal({
  show,
  onClose,
  channelUrl,
  telegramId,
  onCoinsUpdated,
  onRewardSuccess,
}: {
  show: boolean
  onClose: () => void
  channelUrl: string
  telegramId: number | null
  onCoinsUpdated: (coins: number) => void
  onRewardSuccess: () => void
}) {
  const [hasClickedGo, setHasClickedGo] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [isClaiming, setIsClaiming] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const canClaim = useMemo(() => hasClickedGo && cooldown === 0 && !isClaiming, [hasClickedGo, cooldown, isClaiming])

  useEffect(() => {
    if (!show) return
    setHasClickedGo(false)
    setCooldown(0)
    setIsClaiming(false)
    setMessage(null)
  }, [show])

  useEffect(() => {
    if (!show) return
    if (cooldown <= 0) return

    const t = setInterval(() => {
      setCooldown((c) => (c > 0 ? c - 1 : 0))
    }, 1000)

    return () => clearInterval(t)
  }, [show, cooldown])

  const openTelegramLink = (url: string) => {
    if ((window as any).Telegram?.WebApp?.openTelegramLink) {
      ;(window as any).Telegram.WebApp.openTelegramLink(url)
    } else {
      window.open(url, '_blank')
    }
  }

  const handleGoToChannel = () => {
    setMessage(null)
    openTelegramLink(channelUrl)
    setHasClickedGo(true)
    setCooldown(5)
  }

  const handleClaim = async () => {
    if (!telegramId) return
    if (!hasClickedGo || cooldown > 0) return

    setIsClaiming(true)
    setMessage(null)

    try {
      const { data: user, error: fetchError } = await supabase
        .from('users')
        .select('coins, has_joined_channel')
        .eq('telegram_id', telegramId)
        .single()

      if (fetchError) {
        console.error('❌ Failed to check join task status:', fetchError)
        setMessage('Network error. Please try again.')
        return
      }

      const already = user?.has_joined_channel === true
      if (already) {
        setMessage('You have already claimed this reward!')
        return
      }

      const dbCoins = typeof user?.coins === 'string' ? Number(user.coins) : (user?.coins ?? 0)
      const newCoins = (Number.isFinite(dbCoins) ? dbCoins : 0) + 1000

      const { data: updated, error: updateError } = await supabase
        .from('users')
        .update({ coins: newCoins, has_joined_channel: true })
        .eq('telegram_id', telegramId)
        .select('coins')
        .single()

      if (updateError) {
        console.error('❌ Failed to claim join task reward:', updateError)
        setMessage('Claim failed. Please try again.')
        return
      }

      const nextCoins = typeof updated?.coins === 'string' ? Number(updated.coins) : (updated?.coins ?? newCoins)
      onCoinsUpdated(Number.isFinite(nextCoins) ? nextCoins : newCoins)
      onRewardSuccess()
    } catch (e) {
      console.error('❌ Unexpected error claiming join task reward:', e)
      setMessage('Unexpected error. Please try again.')
    } finally {
      setIsClaiming(false)
    }
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
            initial={{ scale: 0.92, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.92, opacity: 0, y: 10 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
            className="relative w-[90%] max-w-sm rounded-xl border border-white/10 bg-slate-900/85 p-4 shadow-[0_0_30px_rgba(34,197,94,0.25)] backdrop-blur-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -inset-px rounded-xl bg-gradient-to-br from-white/10 via-transparent to-emerald-500/20 blur-xl" />

            <div className="relative space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">🌐</span>
                <p className="text-lg font-black text-white">Join our Community</p>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                Subscribe to Oddsflow VIP channel to get exclusive insights and 1000 coins!
              </p>

              {message && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-2 text-xs text-amber-200">
                  {message}
                </div>
              )}

              <div className="flex gap-2">
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={handleGoToChannel}
                  className="flex-1 rounded-lg bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-600 px-3 py-2 text-sm font-bold text-white shadow-[0_0_18px_rgba(59,130,246,0.35)]"
                >
                  Go to Channel ✈️
                </motion.button>
                <motion.button
                  whileTap={{ scale: canClaim ? 0.96 : 1 }}
                  onClick={handleClaim}
                  disabled={!canClaim}
                  className="flex-1 rounded-lg bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 px-3 py-2 text-sm font-black text-white shadow-[0_0_18px_rgba(251,191,36,0.35)] disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {cooldown > 0 ? `Claim Reward 🎁 (${cooldown})` : isClaiming ? 'Claiming...' : 'Claim Reward 🎁'}
                </motion.button>
              </div>

              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={onClose}
                className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                Not now
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
