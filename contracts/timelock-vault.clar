;; Timelock Vault - Clarity 4 Staking Contract
;; Uses stacks-block-time keyword for time-based staking rewards
;; Demonstrates Clarity 4's new temporal capabilities

;; Constants
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u200))
(define-constant err-insufficient-balance (err u201))
(define-constant err-no-stake-found (err u202))
(define-constant err-still-locked (err u203))
(define-constant err-already-staked (err u204))
(define-constant err-invalid-lock-period (err u205))
(define-constant err-zero-amount (err u206))
(define-constant err-reward-mint-failed (err u207))

;; Minimum lock period: 144 blocks (approx 1 day)
(define-constant min-lock-period u144)
;; Maximum lock period: 52560 blocks (approx 1 year)
(define-constant max-lock-period u52560)
;; Base reward rate: 100 reward tokens per 1M microSTX per block
(define-constant base-reward-rate u100)

;; Data Variables
(define-data-var total-staked uint u0)
(define-data-var total-rewards-distributed uint u0)
(define-data-var vault-paused bool false)

;; Data Maps
(define-map stakes
    principal
    {
        amount: uint,
        lock-period: uint,
        unlock-time: uint,
        stake-time: uint
    }
)

(define-map user-stats
    principal
    {
        total-staked: uint,
        total-rewards: uint,
        stake-count: uint
    }
)

;; Read-Only Functions

(define-read-only (get-stake (user principal))
    (map-get? stakes user)
)

(define-read-only (get-user-stats (user principal))
    (default-to
        {total-staked: u0, total-rewards: u0, stake-count: u0}
        (map-get? user-stats user)
    )
)

(define-read-only (get-total-staked)
    (var-get total-staked)
)

(define-read-only (get-total-rewards-distributed)
    (var-get total-rewards-distributed)
)

(define-read-only (is-vault-paused)
    (var-get vault-paused)
)

;; CLARITY 4 FEATURE: Using stacks-block-time for time-based logic
(define-read-only (get-current-block-time)
    stacks-block-time
)

(define-read-only (is-stake-unlocked (user principal))
    (match (map-get? stakes user)
        stake-info (>= stacks-block-time (get unlock-time stake-info))
        false
    )
)

(define-read-only (time-until-unlock (user principal))
    (match (map-get? stakes user)
        stake-info
            (if (>= stacks-block-time (get unlock-time stake-info))
                u0
                (- (get unlock-time stake-info) stacks-block-time)
            )
        u0
    )
)

;; Calculate reward based on amount staked and lock period
;; Longer lock periods = higher rewards (multiplier effect)
(define-read-only (calculate-reward (amount uint) (lock-period uint))
    (let
        (
            (base-reward (/ (* amount base-reward-rate lock-period) u1000000))
            ;; Bonus multiplier: 1x for min period, up to 4x for max period
            (bonus-multiplier (+ u100 (/ (* (- lock-period min-lock-period) u300) max-lock-period)))
        )
        (/ (* base-reward bonus-multiplier) u100)
    )
)

(define-read-only (get-pending-reward (user principal))
    (match (map-get? stakes user)
        stake-info (calculate-reward (get amount stake-info) (get lock-period stake-info))
        u0
    )
)

;; Public Functions

;; Stake STX with a specified lock period
;; CLARITY 4: Uses stacks-block-time to set unlock timestamp
(define-public (stake (amount uint) (lock-period uint))
    (let
        (
            (staker tx-sender)
            ;; CLARITY 4: Using stacks-block-time keyword
            (current-time stacks-block-time)
            (unlock-time (+ current-time lock-period))
        )
        ;; Validations
        (asserts! (not (var-get vault-paused)) (err u208))
        (asserts! (> amount u0) err-zero-amount)
        (asserts! (is-none (map-get? stakes staker)) err-already-staked)
        (asserts! (>= lock-period min-lock-period) err-invalid-lock-period)
        (asserts! (<= lock-period max-lock-period) err-invalid-lock-period)

        ;; Transfer STX from user to contract
        (try! (stx-transfer? amount staker (as-contract tx-sender)))

        ;; Record stake
        (map-set stakes staker {
            amount: amount,
            lock-period: lock-period,
            unlock-time: unlock-time,
            stake-time: current-time
        })

        ;; Update stats
        (var-set total-staked (+ (var-get total-staked) amount))
        (update-user-stats staker amount u0)

        (print {
            action: "stake",
            user: staker,
            amount: amount,
            lock-period: lock-period,
            unlock-time: unlock-time,
            current-time: current-time
        })

        (ok unlock-time)
    )
)

;; Withdraw staked STX and claim rewards
;; CLARITY 4: Uses stacks-block-time to verify unlock time
(define-public (withdraw)
    (let
        (
            (withdrawer tx-sender)
            (stake-info (unwrap! (map-get? stakes withdrawer) err-no-stake-found))
            (amount (get amount stake-info))
            (reward-amount (calculate-reward amount (get lock-period stake-info)))
            ;; CLARITY 4: Using stacks-block-time for time validation
            (current-time stacks-block-time)
        )
        ;; Check if unlock time has been reached
        (asserts! (>= current-time (get unlock-time stake-info)) err-still-locked)

        ;; Return staked STX
        (try! (as-contract (stx-transfer? amount tx-sender withdrawer)))

        ;; Mint reward tokens
        (try! (contract-call? .reward-token mint reward-amount withdrawer))

        ;; Update stats
        (var-set total-staked (- (var-get total-staked) amount))
        (var-set total-rewards-distributed (+ (var-get total-rewards-distributed) reward-amount))
        (update-user-stats withdrawer u0 reward-amount)

        ;; Remove stake record
        (map-delete stakes withdrawer)

        (print {
            action: "withdraw",
            user: withdrawer,
            amount: amount,
            reward: reward-amount,
            current-time: current-time
        })

        (ok {stx-returned: amount, rewards-earned: reward-amount})
    )
)

;; Emergency withdraw (forfeit rewards, only get principal back)
(define-public (emergency-withdraw)
    (let
        (
            (withdrawer tx-sender)
            (stake-info (unwrap! (map-get? stakes withdrawer) err-no-stake-found))
            (amount (get amount stake-info))
        )
        ;; Return staked STX (no rewards in emergency withdrawal)
        (try! (as-contract (stx-transfer? amount tx-sender withdrawer)))

        ;; Update stats
        (var-set total-staked (- (var-get total-staked) amount))

        ;; Remove stake record
        (map-delete stakes withdrawer)

        (print {
            action: "emergency-withdraw",
            user: withdrawer,
            amount: amount,
            current-time: stacks-block-time
        })

        (ok amount)
    )
)

;; Helper function to update user stats
(define-private (update-user-stats (user principal) (staked-amount uint) (reward-amount uint))
    (let
        (
            (current-stats (get-user-stats user))
        )
        (map-set user-stats user {
            total-staked: (+ (get total-staked current-stats) staked-amount),
            total-rewards: (+ (get total-rewards current-stats) reward-amount),
            stake-count: (+ (get stake-count current-stats) u1)
        })
    )
)

;; Admin Functions

(define-public (pause-vault)
    (begin
        (asserts! (is-eq tx-sender contract-owner) err-owner-only)
        (ok (var-set vault-paused true))
    )
)

(define-public (unpause-vault)
    (begin
        (asserts! (is-eq tx-sender contract-owner) err-owner-only)
        (ok (var-set vault-paused false))
    )
)

;; Initialize: Set this contract as an authorized minter for the reward token
(define-public (initialize)
    (begin
        (asserts! (is-eq tx-sender contract-owner) err-owner-only)
        (contract-call? .reward-token authorize-minter (as-contract tx-sender))
    )
)
