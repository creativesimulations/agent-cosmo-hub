/**
 * System API — unified interface for Electron IPC operations.
 * Delegates to focused modules: core (platform/fs), prereqs (checks/installs), hermes (agent lifecycle).
 */

export { isElectron } from './types';
export type { CommandResult, PlatformInfo } from './types';

import { coreAPI } from './core';
import { prereqAPI } from './prereqs';
import { hermesAPI } from './hermes';
import { secretsStore } from './secretsStore';
import { sudoAPI } from './sudo';

export { secretsStore } from './secretsStore';
export { sudoAPI } from './sudo';
export type { SudoState } from './sudo';
export type { SecretsBackend, BackendInfo } from './secretsStore';

export const systemAPI = {
  // Secure secrets store (keychain → safeStorage → plaintext)
  secrets: secretsStore,

  // Core platform
  getPlatform: coreAPI.getPlatform.bind(coreAPI),
  runCommand: coreAPI.runCommand.bind(coreAPI),
  fileExists: coreAPI.fileExists.bind(coreAPI),
  readFile: coreAPI.readFile.bind(coreAPI),
  writeFile: coreAPI.writeFile.bind(coreAPI),
  mkdir: coreAPI.mkdir.bind(coreAPI),
  getDiskSpace: coreAPI.getDiskSpace.bind(coreAPI),

  // Prerequisites
  detectOS: prereqAPI.detectOS.bind(prereqAPI),
  checkWSL: prereqAPI.checkWSL.bind(prereqAPI),
  checkPython: prereqAPI.checkPython.bind(prereqAPI),
  checkPip: prereqAPI.checkPip.bind(prereqAPI),
  checkGit: prereqAPI.checkGit.bind(prereqAPI),
  checkCurl: prereqAPI.checkCurl.bind(prereqAPI),
  checkHermes: prereqAPI.checkHermes.bind(prereqAPI),
  installWSL: prereqAPI.installWSL.bind(prereqAPI),
  installPython: prereqAPI.installPython.bind(prereqAPI),
  installPip: prereqAPI.installPip.bind(prereqAPI),
  installGit: prereqAPI.installGit.bind(prereqAPI),
  installCurl: prereqAPI.installCurl.bind(prereqAPI),
  checkFfmpeg: prereqAPI.checkFfmpeg.bind(prereqAPI),
  installFfmpeg: prereqAPI.installFfmpeg.bind(prereqAPI),
  checkPythonVenv: prereqAPI.checkPythonVenv.bind(prereqAPI),

  // Sudo (in-app password collection for apt installs)
  sudo: sudoAPI,

  // Hermes Agent
  installHermes: hermesAPI.install.bind(hermesAPI),
  installHermesViaPip: hermesAPI.installViaPip.bind(hermesAPI),
  hermesDoctor: hermesAPI.doctor.bind(hermesAPI),
  hermesStatus: hermesAPI.status.bind(hermesAPI),
  hermesUpdate: hermesAPI.update.bind(hermesAPI),
  readEnvFile: hermesAPI.readEnvFile.bind(hermesAPI),
  setEnvVar: hermesAPI.setEnvVar.bind(hermesAPI),
  removeEnvVar: hermesAPI.removeEnvVar.bind(hermesAPI),
  readConfig: hermesAPI.readConfig.bind(hermesAPI),
  writeConfig: hermesAPI.writeConfig.bind(hermesAPI),
  setModel: hermesAPI.setModel.bind(hermesAPI),
  startAgent: hermesAPI.start.bind(hermesAPI),
  startGateway: hermesAPI.startGateway.bind(hermesAPI),
  chatAgent: hermesAPI.chat.bind(hermesAPI),
  writeInitialConfig: hermesAPI.writeInitialConfig.bind(hermesAPI),
  isConfigured: hermesAPI.isConfigured.bind(hermesAPI),
};

export default systemAPI;
