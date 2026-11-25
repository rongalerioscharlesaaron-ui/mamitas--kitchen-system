import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { parseId } from '../utils/validate.js';
import { audit } from '../utils/audit.js';
import {
  listUsers, createUser, updateUser, deleteUser, unlockUser, signOutEverywhere, setMenuItemEnabled,
  updateShopSettings, listBackups, createBackup, getBackupPath,
} from '../services/adminService.js';

const router = Router();
const ownerOnly = [requireAuth, requireRole('owner')];
const who = (req) => ({ userId: req.user.id, username: req.user.username, ip: req.ip });

// Users & Roles
router.get('/users', ...ownerOnly, async (req, res) => {
  res.json({ users: await listUsers() });
});

router.post('/users', ...ownerOnly, async (req, res) => {
  const user = await createUser(req.body);
  await audit({
    ...who(req),
    action: 'admin.user_created',
    entity: 'user',
    entityId: user.id,
    details: { username: user.username, role: user.role },
  });
  res.status(201).json({ user });
});

router.patch('/users/:id', ...ownerOnly, async (req, res) => {
  const id = parseId(req.params.id, 'user id');
  const user = await updateUser(id, req.user.id, req.body);
  await audit({
    ...who(req),
    action: 'admin.user_updated',
    entity: 'user',
    entityId: user.id,
    details: { username: user.username, role: user.role, isActive: user.isActive },
  });
  res.json({ user });
});

// Soft delete: the user disappears and cannot sign in, but their history is kept
router.delete('/users/:id', ...ownerOnly, async (req, res) => {
  const user = await deleteUser(req.params.id, req.user.id);
  await audit({
    ...who(req),
    action: 'admin.user_deleted',
    entity: 'user',
    entityId: user.id,
    details: { username: user.username, fullName: user.fullName, role: user.role },
  });
  res.json({ user });
});

router.post('/users/:id/unlock', ...ownerOnly, async (req, res) => {
  const id = parseId(req.params.id, 'user id');
  const user = await unlockUser(id);
  await audit({
    ...who(req),
    action: 'admin.user_unlocked',
    entity: 'user',
    entityId: user.id,
    details: { username: user.username },
  });
  res.json({ user });
});

router.post('/users/:id/sign-out', ...ownerOnly, async (req, res) => {
  const id = parseId(req.params.id, 'user id');
  const user = await signOutEverywhere(id);
  await audit({
    ...who(req),
    action: 'admin.user_signed_out',
    entity: 'user',
    entityId: user.id,
    details: { username: user.username },
  });
  res.json({ user });
});

// Menu Management: body { enabled: true | false }. A disabled item is hidden from the POS and cannot be
// sold or cooked; its stock and history stay.
router.patch('/menu/:id', ...ownerOnly, async (req, res) => {
  const item = await setMenuItemEnabled(req.params.id, req.body);
  if (item.changed) {
    await audit({
      ...who(req),
      action: item.isEnabled ? 'admin.menu_enabled' : 'admin.menu_disabled',
      entity: 'item',
      entityId: item.id,
      details: { name: item.name, type: item.type, qtyUsable: item.qtyUsable },
    });
  }
  res.json({ item });
});

// System Configuration
router.patch('/shop', ...ownerOnly, async (req, res) => {
  const shop = await updateShopSettings(req.body);
  await audit({
    ...who(req),
    action: 'admin.shop_updated',
    entity: 'shop_settings',
    entityId: '1',
    details: shop,
  });
  res.json({ shop });
});

// Database Backups
router.get('/backups', ...ownerOnly, async (req, res) => {
  res.json({ backups: await listBackups() });
});

router.post('/backups', ...ownerOnly, async (req, res) => {
  const backup = await createBackup();
  await audit({
    ...who(req),
    action: 'admin.backup_created',
    entity: 'backup',
    entityId: backup.filename,
    details: { size: backup.size },
  });
  res.status(201).json({ backup });
});

router.get('/backups/:filename/download', ...ownerOnly, async (req, res) => {
  const fullPath = await getBackupPath(req.params.filename);
  await audit({
    ...who(req),
    action: 'admin.backup_downloaded',
    entity: 'backup',
    entityId: req.params.filename,
  });
  res.download(fullPath, req.params.filename);
});

export default router;