"""merge heads + add org pricing columns

Revision ID: be01ef48d298
Revises: 0d504a6c33ac, add_alert_workflow_fields_002
Create Date: 2025-12-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "be01ef48d298"
down_revision: Union[str, Sequence[str], None] = (
    "0d504a6c33ac",
    "add_alert_workflow_fields_002",
)
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Merge the two heads and add pricing analytics columns to the
    existing `organization` table.
    """
    op.add_column(
        "organization",
        sa.Column("primary_energy_sources", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "organization",
        sa.Column("electricity_price_per_kwh", sa.Numeric(10, 4), nullable=True),
    )
    op.add_column(
        "organization",
        sa.Column("gas_price_per_kwh", sa.Numeric(10, 4), nullable=True),
    )
    op.add_column(
        "organization",
        sa.Column("currency_code", sa.String(length=8), nullable=True),
    )


def downgrade() -> None:
    """
    Drop pricing analytics columns and revert the schema.
    """
    op.drop_column("organization", "currency_code")
    op.drop_column("organization", "gas_price_per_kwh")
    op.drop_column("organization", "electricity_price_per_kwh")
    op.drop_column("organization", "primary_energy_sources")
