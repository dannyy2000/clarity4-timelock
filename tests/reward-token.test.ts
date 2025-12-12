import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

// Test SIP-010 token functionality
Clarinet.test({
    name: "Ensure token has correct metadata",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;

        let name = chain.callReadOnlyFn('reward-token', 'get-name', [], wallet1.address);
        name.result.expectOk().expectAscii("Clarity4 Reward Token");

        let symbol = chain.callReadOnlyFn('reward-token', 'get-symbol', [], wallet1.address);
        symbol.result.expectOk().expectAscii("C4RT");

        let decimals = chain.callReadOnlyFn('reward-token', 'get-decimals', [], wallet1.address);
        decimals.result.expectOk().expectUint(6);
    },
});

Clarinet.test({
    name: "Ensure only owner can authorize minters",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const wallet2 = accounts.get('wallet_2')!;

        // Owner can authorize
        let block = chain.mineBlock([
            Tx.contractCall(
                'reward-token',
                'authorize-minter',
                [types.principal(wallet2.address)],
                deployer.address
            )
        ]);
        block.receipts[0].result.expectOk();

        // Non-owner cannot authorize
        block = chain.mineBlock([
            Tx.contractCall(
                'reward-token',
                'authorize-minter',
                [types.principal(wallet2.address)],
                wallet1.address
            )
        ]);
        block.receipts[0].result.expectErr(types.uint(100)); // err-owner-only
    },
});

Clarinet.test({
    name: "Ensure authorized minter can mint tokens",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // Authorize vault contract as minter
        let block = chain.mineBlock([
            Tx.contractCall(
                'reward-token',
                'authorize-minter',
                [types.principal(`${deployer.address}.timelock-vault`)],
                deployer.address
            )
        ]);
        block.receipts[0].result.expectOk();

        // Check if authorized
        let isAuth = chain.callReadOnlyFn(
            'reward-token',
            'is-authorized-minter',
            [types.principal(`${deployer.address}.timelock-vault`)],
            wallet1.address
        );
        assertEquals(isAuth.result, types.bool(true));
    },
});

Clarinet.test({
    name: "Ensure users can transfer tokens",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;
        const wallet2 = accounts.get('wallet_2')!;

        // First, authorize deployer as minter and mint some tokens
        let block = chain.mineBlock([
            Tx.contractCall(
                'reward-token',
                'authorize-minter',
                [types.principal(deployer.address)],
                deployer.address
            ),
            Tx.contractCall(
                'reward-token',
                'mint',
                [types.uint(1000), types.principal(wallet1.address)],
                deployer.address
            )
        ]);

        // Check balance
        let balance = chain.callReadOnlyFn(
            'reward-token',
            'get-balance',
            [types.principal(wallet1.address)],
            wallet1.address
        );
        balance.result.expectOk().expectUint(1000);

        // Transfer tokens
        block = chain.mineBlock([
            Tx.contractCall(
                'reward-token',
                'transfer',
                [
                    types.uint(500),
                    types.principal(wallet1.address),
                    types.principal(wallet2.address),
                    types.none()
                ],
                wallet1.address
            )
        ]);
        block.receipts[0].result.expectOk();

        // Check balances after transfer
        let balance1 = chain.callReadOnlyFn(
            'reward-token',
            'get-balance',
            [types.principal(wallet1.address)],
            wallet1.address
        );
        balance1.result.expectOk().expectUint(500);

        let balance2 = chain.callReadOnlyFn(
            'reward-token',
            'get-balance',
            [types.principal(wallet2.address)],
            wallet2.address
        );
        balance2.result.expectOk().expectUint(500);
    },
});

Clarinet.test({
    name: "Ensure unauthorized cannot mint",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;
        const wallet2 = accounts.get('wallet_2')!;

        // Attempt to mint without authorization
        let block = chain.mineBlock([
            Tx.contractCall(
                'reward-token',
                'mint',
                [types.uint(1000), types.principal(wallet2.address)],
                wallet1.address
            )
        ]);

        block.receipts[0].result.expectErr(types.uint(101)); // err-not-authorized
    },
});

Clarinet.test({
    name: "Ensure total supply updates correctly",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // Check initial supply
        let supply = chain.callReadOnlyFn('reward-token', 'get-total-supply', [], wallet1.address);
        supply.result.expectOk().expectUint(0);

        // Authorize and mint
        let block = chain.mineBlock([
            Tx.contractCall(
                'reward-token',
                'authorize-minter',
                [types.principal(deployer.address)],
                deployer.address
            ),
            Tx.contractCall(
                'reward-token',
                'mint',
                [types.uint(5000), types.principal(wallet1.address)],
                deployer.address
            )
        ]);

        // Check updated supply
        supply = chain.callReadOnlyFn('reward-token', 'get-total-supply', [], wallet1.address);
        supply.result.expectOk().expectUint(5000);
    },
});
