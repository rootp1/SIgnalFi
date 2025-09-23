module counter_addr::counter {
    use std::signer;

    /// Error codes
    const E_COUNTER_NOT_EXISTS: u64 = 1;

    /// Counter resource that will be stored in user's account
    struct Counter has key {
        value: u64,
    }

    /// Initialize counter for the signer
    public entry fun initialize_counter(account: &signer) {
        let counter = Counter {
            value: 0,
        };
        move_to(account, counter);
    }

    /// Increment the counter by 1
    public entry fun increment(account: &signer) acquires Counter {
        let account_addr = signer::address_of(account);
        assert!(exists<Counter>(account_addr), E_COUNTER_NOT_EXISTS);
        
        let counter = borrow_global_mut<Counter>(account_addr);
        counter.value = counter.value + 1;
    }

    /// Increment the counter by a specific amount
    public entry fun increment_by(account: &signer, amount: u64) acquires Counter {
        let account_addr = signer::address_of(account);
        assert!(exists<Counter>(account_addr), E_COUNTER_NOT_EXISTS);
        
        let counter = borrow_global_mut<Counter>(account_addr);
        counter.value = counter.value + amount;
    }

    /// Get the current counter value
    #[view]
    public fun get_counter(account_addr: address): u64 acquires Counter {
        assert!(exists<Counter>(account_addr), E_COUNTER_NOT_EXISTS);
        borrow_global<Counter>(account_addr).value
    }

    /// Check if counter is initialized for an account
    #[view]
    public fun is_initialized(account_addr: address): bool {
        exists<Counter>(account_addr)
    }

    /// Reset counter to zero
    public entry fun reset(account: &signer) acquires Counter {
        let account_addr = signer::address_of(account);
        assert!(exists<Counter>(account_addr), E_COUNTER_NOT_EXISTS);
        
        let counter = borrow_global_mut<Counter>(account_addr);
        counter.value = 0;
    }
}