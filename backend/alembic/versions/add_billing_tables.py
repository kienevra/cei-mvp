"""add billing_plan and subscription tables

Revision ID: add_billing_tables_001
Revises: <previous_revision_id>
Create Date: 2025-10-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_billing_tables_001'
down_revision = '1234567890ab'
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        'billing_plan',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('stripe_price_id', sa.String(), nullable=False, unique=True),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('amount_cents', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )

    op.create_table(
        'subscription',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), nullable=False, index=True),
        sa.Column('stripe_customer_id', sa.String(), nullable=True, index=True),
        sa.Column('stripe_subscription_id', sa.String(), nullable=True, unique=True, index=True),
        sa.Column('status', sa.String(), nullable=False, index=True),
        sa.Column('current_period_end', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
    )

def downgrade():
    op.drop_table('subscription')
    op.drop_table('billing_plan')
