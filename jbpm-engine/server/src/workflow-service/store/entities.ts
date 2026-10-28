// TypeORM entities for the `workflow_service` Postgres schema — real, typed, per-column tables,
// deliberately separate from ../../store/pg-store.ts's generic `kv_store` blob table (see this
// module's own domain.ts doc comment for why). A handful of genuinely-filtered-on fields get their
// own indexed column; the rest of a case's business payload stays in a `data` jsonb column — a
// common, legitimate hybrid, not a half-measure: it gets real SQL WHERE-pushdown on the fields that
// matter (status/piid/workflowDefinitionId/tenantId) without hand-rolling a full dynamic-DDL system
// for arbitrary user-defined fields.
import { Entity, PrimaryColumn, Column, Index } from 'typeorm';

const SCHEMA = 'workflow_service';
export { SCHEMA };

@Entity({ name: 'workflow_definition', schema: SCHEMA })
@Index(['tenantId', 'name'], { unique: true })
export class WorkflowDefinitionRow {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ name: 'tenant_id', type: 'varchar', length: 128 }) tenantId!: string;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ name: 'deployment_id', type: 'varchar', length: 64 }) deploymentId!: string;
  @Column({ name: 'data_schema', type: 'jsonb' }) dataSchema!: unknown;
  @Column({ name: 'schema_validation_enabled', type: 'boolean', default: false }) schemaValidationEnabled!: boolean;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'created_by', type: 'varchar', length: 128 }) createdBy!: string;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @Column({ name: 'updated_by', type: 'varchar', length: 128 }) updatedBy!: string;
}

@Entity({ name: 'workflow_instance', schema: SCHEMA })
@Index(['tenantId', 'workflowDefinitionId'])
@Index(['tenantId', 'status'])
@Index(['tenantId', 'piid'])
export class WorkflowInstanceRow {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ name: 'tenant_id', type: 'varchar', length: 128 }) tenantId!: string;
  @Column({ name: 'workflow_definition_id', type: 'varchar', length: 64 }) workflowDefinitionId!: string;
  @Column({ name: 'workflow_name', type: 'varchar', length: 200 }) workflowName!: string;
  @Column({ name: 'deployment_id', type: 'varchar', length: 64 }) deploymentId!: string;
  @Column({ type: 'jsonb' }) data!: unknown;
  @Column({ type: 'varchar', length: 64 }) status!: string;
  @Column({ type: 'varchar', length: 64, nullable: true }) piid!: string | null;
  @Column({ name: 'start_error', type: 'text', nullable: true }) startError!: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'created_by', type: 'varchar', length: 128 }) createdBy!: string;
  @Column({ name: 'updated_at', type: 'timestamptz' }) updatedAt!: Date;
  @Column({ name: 'updated_by', type: 'varchar', length: 128 }) updatedBy!: string;
}

@Entity({ name: 'workflow_instance_audit', schema: SCHEMA })
@Index(['tenantId', 'workflowInstanceId'])
export class WorkflowInstanceAuditRow {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ name: 'tenant_id', type: 'varchar', length: 128 }) tenantId!: string;
  @Column({ name: 'workflow_instance_id', type: 'varchar', length: 64 }) workflowInstanceId!: string;
  @Column({ type: 'varchar', length: 128 }) actor!: string;
  @Column({ type: 'varchar', length: 128 }) kind!: string;
  @Column({ type: 'jsonb', nullable: true }) data!: unknown;
  @Column({ type: 'timestamptz' }) at!: Date;
}

@Entity({ name: 'workflow_instance_comment', schema: SCHEMA })
@Index(['tenantId', 'workflowInstanceId'])
export class WorkflowInstanceCommentRow {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ name: 'tenant_id', type: 'varchar', length: 128 }) tenantId!: string;
  @Column({ name: 'workflow_instance_id', type: 'varchar', length: 64 }) workflowInstanceId!: string;
  @Column({ type: 'varchar', length: 128 }) author!: string;
  @Column({ type: 'text' }) body!: string;
  @Column({ type: 'timestamptz' }) at!: Date;
}

@Entity({ name: 'saved_query', schema: SCHEMA })
@Index(['tenantId'])
export class SavedQueryRow {
  @PrimaryColumn({ type: 'varchar', length: 64 }) id!: string;
  @Column({ name: 'tenant_id', type: 'varchar', length: 128 }) tenantId!: string;
  @Column({ name: 'owner_id', type: 'varchar', length: 128, nullable: true }) ownerId!: string | null;
  @Column({ type: 'varchar', length: 200 }) name!: string;
  @Column({ type: 'jsonb' }) definition!: unknown;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'created_by', type: 'varchar', length: 128 }) createdBy!: string;
}

export const WORKFLOW_SERVICE_ENTITIES = [
  WorkflowDefinitionRow, WorkflowInstanceRow, WorkflowInstanceAuditRow, WorkflowInstanceCommentRow, SavedQueryRow,
];
