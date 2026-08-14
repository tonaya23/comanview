import { EntityId } from '../shared/EntityId.js';
import { ModifierOption } from './ModifierOption.js';

export interface ModifierGroupProps {
  id: EntityId;
  name: string;
  minSelections: number;
  maxSelections: number;
  active: boolean;
  options: ModifierOption[];
}

export class ModifierGroup {
  constructor(private readonly props: ModifierGroupProps) {
    if (props.minSelections < 0) {
      throw new Error('minSelections cannot be negative');
    }
    if (props.maxSelections < props.minSelections) {
      throw new Error('maxSelections cannot be less than minSelections');
    }
  }

  get id(): EntityId { return this.props.id; }
  get name(): string { return this.props.name; }
  get minSelections(): number { return this.props.minSelections; }
  get maxSelections(): number { return this.props.maxSelections; }
  get active(): boolean { return this.props.active; }
  get options(): ReadonlyArray<ModifierOption> { return this.props.options; }

  public getOption(optionId: EntityId): ModifierOption | undefined {
    return this.props.options.find(opt => opt.id.equals(optionId));
  }
}
