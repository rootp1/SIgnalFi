// Make sure this is your personal address from the last step
module 0xde6d9e4a03e60733b6b1cd84ef69d39370f20995037458858dcc029bc28a6e1f::signalfi_contract {
    use std::signer;
    use aptos_framework::coin;

    // The hippo dependency is temporarily removed for this test.
    // use hippo::router as hippo_router;

    // The function is simplified to only use one Coin type for the test.
    public entry fun execute_test_transaction<CoinIn>(
        trader: &signer,
        amount_in: u64
    ) {
        let trader_address = signer::address_of(trader);
        let coins_to_swap = coin::withdraw<CoinIn>(trader, amount_in);

        // DEV: This line is just for testing. It does nothing useful,
        // but it proves the rest of our setup is working correctly.
        coin::deposit(trader_address, coins_to_swap);
    }
}