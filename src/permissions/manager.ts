/**
 * Permission manager for OpenMan
 */

import type { ToolPermission } from '@/types';
import { config } from '@/core/config';
import { auditLogger } from '@/core/audit';
import inquirer from 'inquirer';

export class PermissionManager {
  private permissions = config.get('permissions');

  /**
   * Check if an action is allowed based on permissions
   */
  public async checkPermission(
    category: 'web' | 'local' | 'ai',
    action: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    const categoryPerms = this.permissions[category] as Record<string, ToolPermission>;
    const permission = categoryPerms[action];

    await auditLogger.log({
      timestamp: new Date(),
      action: 'permission.check',
      details: { category, action, permission },
      result: 'success',
      riskLevel: 'low',
    });

    switch (permission) {
      case 'always':
        return { allowed: true };

      case 'never':
        return { allowed: false, reason: 'Action is disabled by permission settings' };

      case 'ask':
        return await this.askPermission(category, action);

      case 'explicit':
        return await this.askPermission(category, action, true);

      default:
        return { allowed: false, reason: 'Unknown permission type' };
    }
  }

  /**
   * Ask user for permission
   */
  private async askPermission(
    category: string,
    action: string,
    requireExplicit: boolean = false
  ): Promise<{ allowed: boolean; reason?: string }> {
    const message = requireExplicit
      ? `Allow OpenMan to perform ${category}.${action}? This action requires explicit confirmation.`
      : `Allow OpenMan to perform ${category}.${action}?`;

    const { confirmed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmed',
        message,
        default: false,
      },
    ]);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'permission.ask',
      details: { category, action, confirmed, requireExplicit },
      result: 'success',
      riskLevel: 'low',
      userApproved: confirmed,
    });

    return { allowed: confirmed };
  }

  /**
   * Set permission for a specific action
   */
  public setPermission(
    category: 'web' | 'local' | 'ai',
    action: string,
    permission: ToolPermission
  ): void {
    const categoryPerms = this.permissions[category] as Record<string, ToolPermission>;
    categoryPerms[action] = permission;

    auditLogger.log({
      timestamp: new Date(),
      action: 'permission.set',
      details: { category, action, permission },
      result: 'success',
      riskLevel: 'low',
    });
  }

  /**
   * Get all permissions
   */
  public getAllPermissions() {
    return { ...this.permissions };
  }

  /**
   * Check risk level of an action
   */
  public assessRisk(
    category: string,
    action: string
  ): 'low' | 'medium' | 'high' {
    const highRiskActions = [
      'web.payments',
      'web.sensitive',
      'local.system',
      'local.execute',
    ];

    const mediumRiskActions = [
      'local.write',
      'web.forms',
    ];

    const actionKey = `${category}.${action}`;

    if (highRiskActions.includes(actionKey)) return 'high';
    if (mediumRiskActions.includes(actionKey)) return 'medium';
    return 'low';
  }

  /**
   * Get permission description for user
   */
  public getPermissionDescription(
    category: string,
    action: string
  ): string {
    const descriptions: Record<string, string> = {
      'web.browsing': 'Navigate and browse websites',
      'web.forms': 'Fill and submit web forms',
      'web.payments': 'Make payments online',
      'web.sensitive': 'Access sensitive information',
      'local.read': 'Read local files',
      'local.write': 'Write to local files',
      'local.execute': 'Execute local commands',
      'local.system': 'Access system information',
      'ai.openai': 'Use OpenAI services',
      'ai.anthropic': 'Use Anthropic services',
      'ai.google': 'Use Google AI services',
    };

    return descriptions[`${category}.${action}`] || `${category}.${action}`;
  }
}

// Singleton instance
export const permissionManager = new PermissionManager();
