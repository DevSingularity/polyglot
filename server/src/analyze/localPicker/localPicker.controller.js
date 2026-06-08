import { validateLocalRepository } from '../services/analyze.service.js';
import {
  getLocalPickerCapabilities,
  pickLocalDirectory,
} from '../services/localPicker.service.js';

export async function validateLocalPathController(req, res, next) {
  try {
    const result = await validateLocalRepository(req.body.path);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
}

export async function browseLocalPathController(_req, res, next) {
  try {
    const selectedPath = await pickLocalDirectory();
    return res.status(200).json({ path: selectedPath });
  } catch (err) {
    return next(err);
  }
}

export async function localPickerCapabilitiesController(_req, res, next) {
  try {
    const capabilities = await getLocalPickerCapabilities();
    return res.status(200).json(capabilities);
  } catch (err) {
    return next(err);
  }
}