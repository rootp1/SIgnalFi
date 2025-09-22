import { Router } from 'express';
import {
  upsertUser,
  addSubscription,
  removeSubscription,
  updateSettings,
  getUserDetails,
  sendSignal,
  getPositions,
} from './controller';
import { supabase } from './db';

const router = Router();

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const { data, error } = await supabase.from('users').select('count').limit(1);
    if (error) throw error;
    res.json({ status: 'ok', supabase: 'connected' });
  } catch (error: any) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

router.post('/users', upsertUser);
router.post('/subscriptions', addSubscription);
router.delete('/subscriptions', removeSubscription);
router.put('/settings/:userId', updateSettings);
router.get('/users/:userId/details', getUserDetails);
router.post('/signal', sendSignal);
router.get('/positions/:userId', getPositions);

export default router;
