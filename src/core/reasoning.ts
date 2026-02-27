/**
 * Reasoning and planning engine for OpenMan
 */

import type { Task, AIMessage } from '@/types';
import { aiService } from '@/ai/service';
import { auditLogger } from '@/core/audit';

export class ReasoningEngine {
  private currentTasks: Map<string, Task> = new Map();
  private taskHistory: Task[] = [];

  /**
   * Break down a complex task into subtasks
   */
  public async planTask(description: string): Promise<Task> {
    const taskId = `task-${Date.now()}`;

    const systemPrompt: AIMessage = {
      role: 'system',
      content: `You are a task planning AI. Break down complex tasks into actionable subtasks.
For each subtask, determine:
- What needs to be done
- What tools or services are needed
- What the expected output is
- Any dependencies on other subtasks

Return your response in the following JSON format:
{
  "subtasks": [
    {
      "description": "Task description",
      "tools": ["tool1", "tool2"],
      "output": "Expected output",
      "dependencies": []
    }
  ]
}`,
    };

    const userMessage: AIMessage = {
      role: 'user',
      content: `Break down this task into actionable subtasks: ${description}`,
    };

    const response = await aiService.completion([systemPrompt, userMessage]);

    // Parse the response to extract subtasks
    const subtasks = this.parseSubtasks(response.content);

    const task: Task = {
      id: taskId,
      description,
      status: 'pending',
      subtasks,
      createdAt: new Date(),
    };

    this.currentTasks.set(taskId, task);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'reasoning.plan',
      details: { taskId, description, subtaskCount: subtasks.length },
      result: 'success',
      riskLevel: 'low',
    });

    return task;
  }

  /**
   * Execute a task
   */
  public async executeTask(task: Task): Promise<Task> {
    task.status = 'in_progress';

    if (!task.subtasks || task.subtasks.length === 0) {
      // Simple task without subtasks
      await this.executeSimpleTask(task);
    } else {
      // Complex task with subtasks
      for (const subtask of task.subtasks) {
        if (subtask.status === 'completed') continue;
        await this.executeSubtask(task, subtask);
      }
    }

    task.status = 'completed';
    task.completedAt = new Date();

    this.taskHistory.push(task);
    this.currentTasks.delete(task.id);

    await auditLogger.log({
      timestamp: new Date(),
      action: 'reasoning.execute',
      details: { taskId: task.id, status: task.status },
      result: 'success',
      riskLevel: 'low',
    });

    return task;
  }

  /**
   * Execute a simple task (no subtasks)
   */
  private async executeSimpleTask(task: Task): Promise<void> {
    // Use AI to understand and execute the task
    const systemPrompt: AIMessage = {
      role: 'system',
      content: `You are an AI assistant that helps users with various tasks.
You have access to web browsing, AI services, and local tools.
Execute the given task and provide a helpful response.`,
    };

    const userMessage: AIMessage = {
      role: 'user',
      content: task.description,
    };

    const response = await aiService.completion([systemPrompt, userMessage]);
    task.result = response.content;
  }

  /**
   * Execute a subtask
   */
  private async executeSubtask(task: Task, subtask: Task): Promise<void> {
    subtask.status = 'in_progress';

    // TODO: Implement subtask execution with appropriate tools
    // For now, just mark as completed
    await new Promise((resolve) => setTimeout(resolve, 100));

    subtask.status = 'completed';
    subtask.completedAt = new Date();
  }

  /**
   * Parse subtasks from AI response
   */
  private parseSubtasks(content: string): Task[] {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.subtasks && Array.isArray(parsed.subtasks)) {
          return parsed.subtasks.map((st: any, index: number) => ({
            id: `subtask-${Date.now()}-${index}`,
            description: st.description,
            status: 'pending' as const,
            createdAt: new Date(),
          }));
        }
      }
    } catch (error) {
      console.error('Failed to parse subtasks:', error);
    }

    // If parsing fails, return empty array
    return [];
  }

  /**
   * Get current tasks
   */
  public getCurrentTasks(): Task[] {
    return Array.from(this.currentTasks.values());
  }

  /**
   * Get task history
   */
  public getTaskHistory(): Task[] {
    return [...this.taskHistory];
  }

  /**
   * Get task by ID
   */
  public getTask(id: string): Task | undefined {
    return this.currentTasks.get(id);
  }

  /**
   * Analyze a task and determine the best approach
   */
  public async analyzeTask(description: string): Promise<{
    complexity: 'simple' | 'moderate' | 'complex';
    estimatedTime: string;
    requiredTools: string[];
    riskLevel: 'low' | 'medium' | 'high';
  }> {
    const systemPrompt: AIMessage = {
      role: 'system',
      content: `Analyze the given task and provide a JSON response with:
- complexity: "simple", "moderate", or "complex"
- estimatedTime: time estimate (e.g., "5 minutes", "30 minutes", "2 hours")
- requiredTools: list of tools needed
- riskLevel: "low", "medium", or "high"

Return only the JSON, no other text.`,
    };

    const userMessage: AIMessage = {
      role: 'user',
      content: `Analyze this task: ${description}`,
    };

    const response = await aiService.completion([systemPrompt, userMessage]);

    try {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('Failed to analyze task:', error);
    }

    // Default analysis
    return {
      complexity: 'moderate',
      estimatedTime: '10 minutes',
      requiredTools: [],
      riskLevel: 'low',
    };
  }
}

// Singleton instance
export const reasoningEngine = new ReasoningEngine();
