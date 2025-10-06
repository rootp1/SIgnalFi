module signalfi::registry {
    use std::signer;
    use aptos_framework::timestamp;
        use aptos_framework::event; // for event::emit

    /// Core trader state
    struct Trader has key { telegram_hash: vector<u8>, next_signal_seq: u64 }

    /// Last anchored payload metadata for quick verification
    struct LastAnchor has key { last_seq: u64, last_hash: vector<u8>, last_ts: u64 }

    /// Events
    #[event]
    struct TraderRegistered has drop, store { trader: address, telegram_hash: vector<u8> }
    #[event]
    struct SignalAnchored has drop, store { trader: address, seq: u64, payload_hash: vector<u8>, ts: u64 }

    /// Register trader (self)
    public entry fun register_trader(account: &signer, telegram_hash: vector<u8>) {
        let addr = signer::address_of(account);
        assert!(!exists<Trader>(addr), 1);
        move_to(account, Trader { telegram_hash, next_signal_seq: 0 });
            event::emit(TraderRegistered { trader: addr, telegram_hash });
    }

    /// (admin_register_trader removed: cannot create resource under arbitrary address without its signer.)

    /// Anchors a payload hash (e.g., SHA3-256) and returns updated seq (emitted in event).
    public entry fun anchor_signal(account: &signer, payload_hash: vector<u8>) {
        let addr = signer::address_of(account);
        assert!(exists<Trader>(addr), 2);
        let trader_ref = borrow_global_mut<Trader>(addr);
        let seq = trader_ref.next_signal_seq;
        trader_ref.next_signal_seq = seq + 1;
        let ts = timestamp::now_seconds();
        if (exists<LastAnchor>(addr)) { let la = borrow_global_mut<LastAnchor>(addr); la.last_seq = seq; la.last_hash = payload_hash; la.last_ts = ts; } else { move_to(account, LastAnchor { last_seq: seq, last_hash: payload_hash, last_ts: ts }); };
           event::emit(SignalAnchored { trader: addr, seq, payload_hash, ts });
    }

    /// Relay anchoring: allows the deployer (@signalfi) to anchor on behalf of a trader address.
    /// Security model: centralized relayer for hackathon phase. Future: capability or multi-agent.
    public entry fun anchor_signal_relay(relayer: &signer, trader_addr: address, payload_hash: vector<u8>) acquires Trader, LastAnchor {
        let relayer_addr = signer::address_of(relayer);
        assert!(relayer_addr == @signalfi, 10); // only module deployer
        assert!(exists<Trader>(trader_addr), 11);
        let trader_ref = borrow_global_mut<Trader>(trader_addr);
        let seq = trader_ref.next_signal_seq;
        trader_ref.next_signal_seq = seq + 1;
        let ts = timestamp::now_seconds();
        if (exists<LastAnchor>(trader_addr)) { let la2 = borrow_global_mut<LastAnchor>(trader_addr); la2.last_seq = seq; la2.last_hash = payload_hash; la2.last_ts = ts; } else { /* cannot create under trader without signer; omit */ };
           event::emit(SignalAnchored { trader: trader_addr, seq, payload_hash, ts });
    }

    /// View function: returns next seq (thus highest existing seq is next_seq - 1)
    public fun get_next_seq(addr: address): u64 acquires Trader {
        if (exists<Trader>(addr)) {
            let t = borrow_global<Trader>(addr);
            t.next_signal_seq
        } else {
            0
        }
    }

    public fun get_last_anchor(addr: address): (bool, u64, vector<u8>, u64) acquires LastAnchor {
        if (exists<LastAnchor>(addr)) {
            let r = borrow_global<LastAnchor>(addr);
            (true, r.last_seq, r.last_hash, r.last_ts)
        } else { (false, 0, b"", 0) }
    }
}
