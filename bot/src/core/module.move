// In file: SignalFiContract/sources/module.move

module 0x170581a3a9a95761c0839bdbfd03fc036f87295e105236a4dcfd26232a10386b::signalfi_contract {

    use std::signer;
    use aptos_framework::coin;

    // FIX: The module name is 'router', not 'aggregator'.
    // We also give it a new alias to match.
    use hippo::router as hippo_router;

    const E_SWAP_FAILED: u64 = 1;

    public entry fun execute_single_swap<CoinIn, CoinOut>(
        trader: &signer,
        amount_in: u64
    ) {
        let trader_address = signer::address_of(trader);
        let coins_to_swap = coin::withdraw<CoinIn>(trader, amount_in);

        // FIX: Call the function using the correct module alias, 'hippo_router'.
        let coins_received = hippo_router::swap<CoinIn, CoinOut>(coins_to_swap);
        
        coin::deposit(trader_address, coins_received);
    }
}