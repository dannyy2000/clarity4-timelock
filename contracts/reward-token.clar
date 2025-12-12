;; Reward Token - SIP-010 Fungible Token
;; This token is minted as rewards for users who stake in the timelock vault

;; SIP-010 Trait
(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

;; Token definitions
(define-fungible-token reward-token)

;; Constants
(define-constant contract-owner tx-sender)
(define-constant err-owner-only (err u100))
(define-constant err-not-authorized (err u101))
(define-constant err-insufficient-balance (err u102))

;; Token metadata
(define-data-var token-name (string-ascii 32) "Clarity4 Reward Token")
(define-data-var token-symbol (string-ascii 10) "C4RT")
(define-data-var token-uri (optional (string-utf8 256)) none)
(define-data-var token-decimals uint u6)

;; Authorization map - allows the vault contract to mint rewards
(define-map authorized-minters principal bool)

;; SIP-010 Functions

(define-read-only (get-name)
    (ok (var-get token-name))
)

(define-read-only (get-symbol)
    (ok (var-get token-symbol))
)

(define-read-only (get-decimals)
    (ok (var-get token-decimals))
)

(define-read-only (get-balance (who principal))
    (ok (ft-get-balance reward-token who))
)

(define-read-only (get-total-supply)
    (ok (ft-get-supply reward-token))
)

(define-read-only (get-token-uri)
    (ok (var-get token-uri))
)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
    (begin
        (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) err-not-authorized)
        (try! (ft-transfer? reward-token amount sender recipient))
        (match memo to-print (print to-print) 0x)
        (ok true)
    )
)

;; Admin Functions

(define-public (set-token-uri (new-uri (string-utf8 256)))
    (begin
        (asserts! (is-eq tx-sender contract-owner) err-owner-only)
        (ok (var-set token-uri (some new-uri)))
    )
)

(define-public (authorize-minter (minter principal))
    (begin
        (asserts! (is-eq tx-sender contract-owner) err-owner-only)
        (ok (map-set authorized-minters minter true))
    )
)

(define-public (revoke-minter (minter principal))
    (begin
        (asserts! (is-eq tx-sender contract-owner) err-owner-only)
        (ok (map-delete authorized-minters minter))
    )
)

(define-read-only (is-authorized-minter (minter principal))
    (default-to false (map-get? authorized-minters minter))
)

;; Minting function - can only be called by authorized minters (vault contract)
(define-public (mint (amount uint) (recipient principal))
    (begin
        (asserts! (is-authorized-minter contract-caller) err-not-authorized)
        (ft-mint? reward-token amount recipient)
    )
)

;; Burning function
(define-public (burn (amount uint) (sender principal))
    (begin
        (asserts! (or (is-eq tx-sender sender) (is-eq contract-caller sender)) err-not-authorized)
        (ft-burn? reward-token amount sender)
    )
)
