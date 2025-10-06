module signalfi::vault {
    use std::signer;
    use aptos_framework::timestamp;
    use aptos_framework::event; // for event::emit

    /// Simple initialized marker resource.
    struct Vault has key { initialized: bool }

    #[event]
    struct TradeExecuted has drop, store { intent_hash: vector<u8>, follower_count: u64, ts: u64 }

    /// Initialize vault under deployer address if not present.
    public entry fun init(admin: &signer) {
        let addr = signer::address_of(admin);
        if (!exists<Vault>(addr)) {
            move_to(admin, Vault { initialized: true });
        }
    }

    /// Record a trade execution (intent hash bytes + follower count snapshot).
    /// Security: only deployer (module account) controls this signer in hackathon phase.
    public entry fun execute_trade(relayer: &signer, intent_hash: vector<u8>, follower_count: u64) {
        let addr = signer::address_of(relayer);
        // require vault initialized
        assert!(exists<Vault>(addr), 1);
        let ts = timestamp::now_seconds();
        event::emit(TradeExecuted { intent_hash, follower_count, ts });
    }
}
