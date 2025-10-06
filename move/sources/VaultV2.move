module signalfi::vault_v2 {
    use std::signer;
    use aptos_framework::timestamp;
    use aptos_framework::event;

    struct VaultV2 has key { initialized: bool }

    #[event]
    struct TradeExecutedV2 has drop, store { intent_hash: vector<u8>, plan_hash: vector<u8>, follower_count: u64, schema_version: u64, ts: u64 }

    public entry fun init(admin: &signer) {
        let addr = signer::address_of(admin);
        if (!exists<VaultV2>(addr)) {
            move_to(admin, VaultV2 { initialized: true });
        }
    }

    public entry fun execute_trade_v2(relayer: &signer, intent_hash: vector<u8>, plan_hash: vector<u8>, follower_count: u64, schema_version: u64) {
        let addr = signer::address_of(relayer);
        assert!(exists<VaultV2>(addr), 1);
        let ts = timestamp::now_seconds();
        event::emit(TradeExecutedV2 { intent_hash, plan_hash, follower_count, schema_version, ts });
    }
}
