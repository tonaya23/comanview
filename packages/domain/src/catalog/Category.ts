import { EntityId } from '../shared/EntityId.js';

export interface CategoryProps {
  id: EntityId;
  name: string;
  displayOrder: number;
  active: boolean;
}

export class Category {
  constructor(private readonly props: CategoryProps) {}

  get id(): EntityId { return this.props.id; }
  get name(): string { return this.props.name; }
  get displayOrder(): number { return this.props.displayOrder; }
  get active(): boolean { return this.props.active; }

  public activate(): Category {
    return new Category({ ...this.props, active: true });
  }

  public deactivate(): Category {
    return new Category({ ...this.props, active: false });
  }
}
