
import { Request, Response } from 'express';
import { supabase } from './db';

export const upsertUser = async (req: Request, res: Response) => {
  const { telegramId, username } = req.body;
  try {
    const { error } = await supabase
      .from('users')
      .upsert({ 
        telegram_id: telegramId, 
        username: username 
      }, { onConflict: 'telegram_id' });
    
    if (error) throw error;

    res.status(201).send({ message: 'User created or already exists.' });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Internal server error' });
  }
};

export const addSubscription = async (req: Request, res: Response) => {
  const { followerId, broadcasterId } = req.body;
  try {
    const { error } = await supabase
      .from('subscriptions')
      .insert({ 
        follower_telegram_id: followerId, 
        broadcaster_username: `Trader${broadcasterId}` 
      });
    
    if (error) throw error;
    
    res.status(201).send({ message: 'Subscription added.' });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Internal server error' });
  }
};

export const removeSubscription = async (req: Request, res: Response) => {
  const { followerId, broadcasterId } = req.body;
  try {
    const { error } = await supabase
      .from('subscriptions')
      .delete()
      .eq('follower_telegram_id', followerId)
      .eq('broadcaster_username', `Trader${broadcasterId}`);
    
    if (error) throw error;
    
    res.status(200).send({ message: 'Subscription removed.' });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Internal server error' });
  }
};

export const updateSettings = async (req: Request, res: Response) => {
  const { userId } = req.params;
  const { tradeAmount } = req.body;
  try {
    const { error } = await supabase
      .from('users')
      .update({ trade_amount: tradeAmount })
      .eq('telegram_id', userId);
    
    if (error) throw error;
    
    res.status(200).send({ message: 'Settings updated.' });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Internal server error' });
  }
};

export const getUserDetails = async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('trade_amount')
      .eq('telegram_id', userId)
      .single();

    const { data: subscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('broadcaster_username')
      .eq('follower_telegram_id', userId);
    
    if (userError || subsError) {
      throw userError || subsError;
    }
    
    const details = {
      settings: { trade_amount: user?.trade_amount || 25.0 },
      following: subscriptions.map((s: any) => s.broadcaster_username),
    };

    res.status(200).json(details);
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Internal server error' });
  }
};

export const sendSignal = async (req: Request, res: Response) => {
  const { broadcasterId, action, amount, token } = req.body;
  try {
    // Get all followers of this broadcaster
    const { data: followers, error: followersError } = await supabase
      .from('subscriptions')
      .select('follower_telegram_id')
      .eq('broadcaster_username', `Trader${broadcasterId}`);
    
    if (followersError) throw followersError;

    if (!followers || followers.length === 0) {
      return res.status(200).json({ message: 'No followers found.', followerCount: 0 });
    }

    // Get follower details for trade execution
    const followerIds = followers.map((f: any) => f.follower_telegram_id);
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('telegram_id, trade_amount')
      .in('telegram_id', followerIds);

    if (usersError) throw usersError;

    // Record positions for each follower
    if (users && users.length > 0) {
        const mockPrice = 8.50; // Replace with actual price logic if available
        const positionsToInsert = users.map((user: { telegram_id: number; trade_amount: number }) => ({
            user_id: user.telegram_id,
            token: token,
            quantity: user.trade_amount / mockPrice, // Assuming trade_amount is in USDC
            entry_price: mockPrice,
            action: action
        }));

        const { error: insertError } = await supabase
            .from('positions')
            .insert(positionsToInsert);

        if (insertError) {
            console.error('Error inserting positions:', insertError);
            // Decide if you should halt or just log the error
        }
    }

    const signalData = {
      action,
      amount,
      token,
      followers: users,
      followerCount: followers.length
    };

    res.status(200).json({ 
      message: 'Signal processed successfully', 
      data: signalData 
    });
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Internal server error' });
  }
};

export const getPositions = async (req: Request, res: Response) => {
  const { userId } = req.params;
  try {
    const { data, error } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.status(200).json(data);
  } catch (error) {
    console.error(error);
    res.status(500).send({ error: 'Internal server error' });
  }
};
