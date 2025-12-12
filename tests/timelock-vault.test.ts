import { Clarinet, Tx, Chain, Account, types } from 'https://deno.land/x/clarinet@v1.0.0/index.ts';
import { assertEquals } from 'https://deno.land/std@0.90.0/testing/asserts.ts';

// Test staking functionality
Clarinet.test({
    name: "Ensure users can stake STX with valid lock period",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // Initialize the vault
        let block = chain.mineBlock([
            Tx.contractCall('timelock-vault', 'initialize', [], deployer.address)
        ]);
        block.receipts[0].result.expectOk();

        // Stake 1000 STX with minimum lock period
        block = chain.mineBlock([
            Tx.contractCall(
                'timelock-vault',
                'stake',
                [types.uint(1000000000), types.uint(144)], // 1000 STX, 144 blocks
                wallet1.address
            )
        ]);

        block.receipts[0].result.expectOk();

        // Verify stake was recorded
        let stake = chain.callReadOnlyFn(
            'timelock-vault',
            'get-stake',
            [types.principal(wallet1.address)],
            wallet1.address
        );

        const stakeData = stake.result.expectSome().expectTuple();
        assertEquals(stakeData['amount'], types.uint(1000000000));
    },
});

Clarinet.test({
    name: "Ensure users cannot stake with lock period below minimum",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;

        let block = chain.mineBlock([
            Tx.contractCall(
                'timelock-vault',
                'stake',
                [types.uint(1000000000), types.uint(100)], // Below minimum
                wallet1.address
            )
        ]);

        block.receipts[0].result.expectErr(types.uint(205)); // err-invalid-lock-period
    },
});

Clarinet.test({
    name: "Ensure users cannot withdraw before unlock time (using stacks-block-time)",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // Initialize
        let block = chain.mineBlock([
            Tx.contractCall('timelock-vault', 'initialize', [], deployer.address)
        ]);

        // Stake with 144 block lock period
        block = chain.mineBlock([
            Tx.contractCall(
                'timelock-vault',
                'stake',
                [types.uint(1000000000), types.uint(144)],
                wallet1.address
            )
        ]);
        block.receipts[0].result.expectOk();

        // Try to withdraw immediately (should fail)
        block = chain.mineBlock([
            Tx.contractCall('timelock-vault', 'withdraw', [], wallet1.address)
        ]);

        block.receipts[0].result.expectErr(types.uint(203)); // err-still-locked
    },
});

Clarinet.test({
    name: "Ensure users can withdraw after unlock time and receive rewards",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // Initialize
        let block = chain.mineBlock([
            Tx.contractCall('timelock-vault', 'initialize', [], deployer.address)
        ]);

        // Stake
        block = chain.mineBlock([
            Tx.contractCall(
                'timelock-vault',
                'stake',
                [types.uint(1000000000), types.uint(144)],
                wallet1.address
            )
        ]);

        // Mine 144 blocks to reach unlock time
        chain.mineEmptyBlockUntil(chain.blockHeight + 144);

        // Withdraw
        block = chain.mineBlock([
            Tx.contractCall('timelock-vault', 'withdraw', [], wallet1.address)
        ]);

        block.receipts[0].result.expectOk();

        // Check that user received reward tokens
        let balance = chain.callReadOnlyFn(
            'reward-token',
            'get-balance',
            [types.principal(wallet1.address)],
            wallet1.address
        );

        // Should have received some reward tokens
        const rewardBalance = balance.result.expectOk();
        assertEquals(Number(rewardBalance) > 0, true);
    },
});

Clarinet.test({
    name: "Test stacks-block-time accuracy",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;

        // Get current block time
        let blockTime1 = chain.callReadOnlyFn(
            'timelock-vault',
            'get-current-block-time',
            [],
            wallet1.address
        );

        // Mine a block
        chain.mineEmptyBlock();

        // Get new block time (should be greater)
        let blockTime2 = chain.callReadOnlyFn(
            'timelock-vault',
            'get-current-block-time',
            [],
            wallet1.address
        );

        const time1 = Number(blockTime1.result);
        const time2 = Number(blockTime2.result);

        // Time should have progressed
        assertEquals(time2 > time1, true);
    },
});

Clarinet.test({
    name: "Test emergency withdrawal (no rewards)",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const deployer = accounts.get('deployer')!;
        const wallet1 = accounts.get('wallet_1')!;

        // Initialize
        let block = chain.mineBlock([
            Tx.contractCall('timelock-vault', 'initialize', [], deployer.address)
        ]);

        // Stake
        block = chain.mineBlock([
            Tx.contractCall(
                'timelock-vault',
                'stake',
                [types.uint(1000000000), types.uint(144)],
                wallet1.address
            )
        ]);

        // Emergency withdraw immediately
        block = chain.mineBlock([
            Tx.contractCall('timelock-vault', 'emergency-withdraw', [], wallet1.address)
        ]);

        block.receipts[0].result.expectOk().expectUint(1000000000);

        // Check no reward tokens were minted
        let balance = chain.callReadOnlyFn(
            'reward-token',
            'get-balance',
            [types.principal(wallet1.address)],
            wallet1.address
        );

        balance.result.expectOk().expectUint(0); // No rewards
    },
});

Clarinet.test({
    name: "Test reward calculation increases with longer lock periods",
    async fn(chain: Chain, accounts: Map<string, Account>) {
        const wallet1 = accounts.get('wallet_1')!;

        // Calculate reward for short lock period
        let shortReward = chain.callReadOnlyFn(
            'timelock-vault',
            'calculate-reward',
            [types.uint(1000000000), types.uint(144)],
            wallet1.address
        );

        // Calculate reward for long lock period
        let longReward = chain.callReadOnlyFn(
            'timelock-vault',
            'calculate-reward',
            [types.uint(1000000000), types.uint(10000)],
            wallet1.address
        );

        const shortAmount = Number(shortReward.result);
        const longAmount = Number(longReward.result);

        // Longer lock period should yield higher rewards
        assertEquals(longAmount > shortAmount, true);
    },
});
