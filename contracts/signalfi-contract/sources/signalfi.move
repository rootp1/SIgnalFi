module signalfi_addr::signalfi {
    use std::signer;
    use std::vector;
    use aptos_framework::account;
    use aptos_framework::event;

    /// Error codes
    const E_NOT_AUTHORIZED: u64 = 1;
    const E_NOT_OWNER: u64 = 2;
    const E_INPUT_VECTORS_MISMATCH: u64 = 3;
    const E_CONFIG_NOT_EXISTS: u64 = 4;
    const E_OWNER_CAPABILITY_NOT_EXISTS: u64 = 5;
    const E_EMPTY_FOLLOWER_LIST: u64 = 6;
    const E_INVALID_MARKET_ID: u64 = 7;
    const E_INVALID_POSITION_SIZE: u64 = 8;

    /// Owner capability - proves ownership of the contract
    struct OwnerCapability has key {}

    /// Configuration stored under the contract's account
    struct Config has key {
        backend_address: address,
        admin_events: event::EventHandle<AdminEvent>,
        execution_events: event::EventHandle<ExecutionEvent>,
    }

    /// Event emitted when admin operations occur
    struct AdminEvent has drop, store {
        event_type: u8, // 1 = backend_address_updated, 2 = contract_initialized
        old_backend_address: address,
        new_backend_address: address,
        timestamp: u64,
    }

    /// Event emitted when trade bundles are executed
    struct ExecutionEvent has drop, store {
        market_id: u64,
        is_long: bool,
        total_followers: u64,
        total_volume: u64,
        backend_address: address,
        timestamp: u64,
    }

    /// Initialize the contract - called once during deployment
    public entry fun initialize(
        owner: &signer,
        initial_backend_address: address
    ) acquires Config {
        let owner_addr = signer::address_of(owner);
        
        // Create and store owner capability
        let owner_cap = OwnerCapability {};
        move_to(owner, owner_cap);

        // Create and store config under contract account
        let config = Config {
            backend_address: initial_backend_address,
            admin_events: account::new_event_handle<AdminEvent>(owner),
            execution_events: account::new_event_handle<ExecutionEvent>(owner),
        };
        move_to(owner, config);

        // Emit initialization event
        let config_ref = borrow_global_mut<Config>(owner_addr);
        event::emit_event<AdminEvent>(
            &mut config_ref.admin_events,
            AdminEvent {
                event_type: 2,
                old_backend_address: @0x0,
                new_backend_address: initial_backend_address,
                timestamp: aptos_framework::timestamp::now_microseconds(),
            },
        );
    }

    /// Main execution function for atomic copy trading
    public entry fun open_atomic_position_bundle(
        backend_signer: &signer,
        contract_address: address,
        market_id: u64,
        is_long: bool,
        follower_addresses: vector<address>,
        follower_sizes: vector<u64>
    ) acquires Config {
        // Authorization check
        let backend_addr = signer::address_of(backend_signer);
        assert!(exists<Config>(contract_address), E_CONFIG_NOT_EXISTS);
        
        let config = borrow_global<Config>(contract_address);
        assert!(backend_addr == config.backend_address, E_NOT_AUTHORIZED);

        // Input validation
        let follower_count = vector::length(&follower_addresses);
        let sizes_count = vector::length(&follower_sizes);
        assert!(follower_count == sizes_count, E_INPUT_VECTORS_MISMATCH);
        assert!(follower_count > 0, E_EMPTY_FOLLOWER_LIST);
        assert!(market_id > 0, E_INVALID_MARKET_ID);

        // Calculate total volume for event
        let total_volume = 0u64;
        let i = 0u64;
        
        // Execution loop - this is where the magic happens
        while (i < follower_count) {
            let follower_addr = *vector::borrow(&follower_addresses, i);
            let position_size = *vector::borrow(&follower_sizes, i);
            
            // Validate position size
            assert!(position_size > 0, E_INVALID_POSITION_SIZE);
            total_volume = total_volume + position_size;

            // Here you would call the actual perpetuals protocol
            // For example, if integrating with a protocol like "perp_protocol":
            // perp_protocol::open_position(
            //     follower_addr,
            //     market_id,
            //     position_size,
            //     is_long
            // );
            
            // For now, we'll simulate the execution
            execute_single_trade(follower_addr, market_id, position_size, is_long);
            
            i = i + 1;
        };

        // Emit execution event
        let config_mut = borrow_global_mut<Config>(contract_address);
        event::emit_event<ExecutionEvent>(
            &mut config_mut.execution_events,
            ExecutionEvent {
                market_id,
                is_long,
                total_followers: follower_count,
                total_volume,
                backend_address: backend_addr,
                timestamp: aptos_framework::timestamp::now_microseconds(),
            },
        );
    }

    /// Administrative function to update backend address
    public entry fun set_backend_address(
        owner_signer: &signer,
        contract_address: address,
        new_backend_address: address
    ) acquires OwnerCapability, Config {
        let owner_addr = signer::address_of(owner_signer);
        
        // Owner check
        assert!(exists<OwnerCapability>(owner_addr), E_OWNER_CAPABILITY_NOT_EXISTS);
        assert!(exists<Config>(contract_address), E_CONFIG_NOT_EXISTS);
        
        // Verify ownership (in a real implementation, you might want additional checks)
        let _owner_cap = borrow_global<OwnerCapability>(owner_addr);
        
        // Update backend address
        let config = borrow_global_mut<Config>(contract_address);
        let old_backend_address = config.backend_address;
        config.backend_address = new_backend_address;

        // Emit admin event
        event::emit_event<AdminEvent>(
            &mut config.admin_events,
            AdminEvent {
                event_type: 1,
                old_backend_address,
                new_backend_address,
                timestamp: aptos_framework::timestamp::now_microseconds(),
            },
        );
    }

    /// Helper function to simulate trade execution
    /// In production, this would call the actual perpetuals protocol
    fun execute_single_trade(
        _follower_addr: address,
        _market_id: u64,
        _position_size: u64,
        _is_long: bool
    ) {
        // This is where you'd integrate with your chosen perpetuals protocol
        // Examples of what this might look like:
        
        // Option 1: Direct protocol integration
        // perpetuals_protocol::open_position(follower_addr, market_id, position_size, is_long);
        
        // Option 2: Market maker integration  
        // market_maker::execute_trade(follower_addr, market_id, position_size, is_long);
        
        // Option 3: DEX integration
        // dex_protocol::swap_for_position(follower_addr, market_id, position_size, is_long);
        
        // For now, we just validate the inputs are reasonable
        assert!(_position_size > 0, E_INVALID_POSITION_SIZE);
        assert!(_market_id > 0, E_INVALID_MARKET_ID);
        
        // In a real implementation, this function would handle:
        // - Margin checks
        // - Position opening
        // - Fee calculations
        // - Risk management
        // - Protocol-specific logic
    }

    /// View function to get current backend address
    #[view]
    public fun get_backend_address(contract_address: address): address acquires Config {
        assert!(exists<Config>(contract_address), E_CONFIG_NOT_EXISTS);
        borrow_global<Config>(contract_address).backend_address
    }

    /// View function to check if address is the owner
    #[view]
    public fun is_owner(account_address: address): bool {
        exists<OwnerCapability>(account_address)
    }

    /// View function to check if contract is initialized
    #[view]
    public fun is_initialized(contract_address: address): bool {
        exists<Config>(contract_address)
    }

    /// Emergency pause function (optional safety feature)
    public entry fun emergency_pause(
        owner_signer: &signer,
        contract_address: address
    ) acquires OwnerCapability, Config {
        let owner_addr = signer::address_of(owner_signer);
        
        // Owner check
        assert!(exists<OwnerCapability>(owner_addr), E_OWNER_CAPABILITY_NOT_EXISTS);
        assert!(exists<Config>(contract_address), E_CONFIG_NOT_EXISTS);
        
        let _owner_cap = borrow_global<OwnerCapability>(owner_addr);
        
        // Set backend address to zero to effectively pause the contract
        let config = borrow_global_mut<Config>(contract_address);
        let old_backend_address = config.backend_address;
        config.backend_address = @0x0;

        // Emit admin event
        event::emit_event<AdminEvent>(
            &mut config.admin_events,
            AdminEvent {
                event_type: 1,
                old_backend_address,
                new_backend_address: @0x0,
                timestamp: aptos_framework::timestamp::now_microseconds(),
            },
        );
    }

    /// Simple test function with hardcoded values for CLI testing
    public entry fun test_single_trade(
        backend_signer: &signer,
        contract_address: address,
        market_id: u64,
        is_long: bool,
        follower_addr: address,
        position_size: u64
    ) acquires Config {
        // Authorization check
        let backend_addr = signer::address_of(backend_signer);
        assert!(exists<Config>(contract_address), E_CONFIG_NOT_EXISTS);
        
        let config = borrow_global<Config>(contract_address);
        assert!(backend_addr == config.backend_address, E_NOT_AUTHORIZED);

        // Input validation
        assert!(market_id > 0, E_INVALID_MARKET_ID);
        assert!(position_size > 0, E_INVALID_POSITION_SIZE);

        // Execute single trade
        execute_single_trade(follower_addr, market_id, position_size, is_long);

        // Emit execution event
        let config_mut = borrow_global_mut<Config>(contract_address);
        event::emit_event<ExecutionEvent>(
            &mut config_mut.execution_events,
            ExecutionEvent {
                market_id,
                is_long,
                total_followers: 1,
                total_volume: position_size,
                backend_address: backend_addr,
                timestamp: aptos_framework::timestamp::now_microseconds(),
            },
        );
    }

    /// Batch execution with different markets (advanced feature)
    public entry fun open_multi_market_position_bundle(
        backend_signer: &signer,
        contract_address: address,
        market_ids: vector<u64>,
        is_long_flags: vector<bool>,
        follower_addresses: vector<address>,
        follower_sizes: vector<u64>
    ) acquires Config {
        // Authorization check
        let backend_addr = signer::address_of(backend_signer);
        assert!(exists<Config>(contract_address), E_CONFIG_NOT_EXISTS);
        
        let config = borrow_global<Config>(contract_address);
        assert!(backend_addr == config.backend_address, E_NOT_AUTHORIZED);

        // Input validation
        let market_count = vector::length(&market_ids);
        let flags_count = vector::length(&is_long_flags);
        let follower_count = vector::length(&follower_addresses);
        let sizes_count = vector::length(&follower_sizes);
        
        assert!(market_count == flags_count, E_INPUT_VECTORS_MISMATCH);
        assert!(follower_count == sizes_count, E_INPUT_VECTORS_MISMATCH);
        assert!(market_count > 0 && follower_count > 0, E_EMPTY_FOLLOWER_LIST);

        let total_volume = 0u64;
        
        // Execute trades for each market
        let market_i = 0u64;
        while (market_i < market_count) {
            let market_id = *vector::borrow(&market_ids, market_i);
            let is_long = *vector::borrow(&is_long_flags, market_i);
            
            // Execute trades for each follower in this market
            let follower_i = 0u64;
            while (follower_i < follower_count) {
                let follower_addr = *vector::borrow(&follower_addresses, follower_i);
                let position_size = *vector::borrow(&follower_sizes, follower_i);
                
                execute_single_trade(follower_addr, market_id, position_size, is_long);
                total_volume = total_volume + position_size;
                
                follower_i = follower_i + 1;
            };
            
            market_i = market_i + 1;
        };

        // Emit execution event for multi-market trade
        let config_mut = borrow_global_mut<Config>(contract_address);
        event::emit_event<ExecutionEvent>(
            &mut config_mut.execution_events,
            ExecutionEvent {
                market_id: 0, // 0 indicates multi-market trade
                is_long: true, // Not applicable for multi-market
                total_followers: follower_count,
                total_volume,
                backend_address: backend_addr,
                timestamp: aptos_framework::timestamp::now_microseconds(),
            },
        );
    }
}