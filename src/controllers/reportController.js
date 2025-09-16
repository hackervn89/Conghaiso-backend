const db = require('../config/database');

const getTasksByOrganizationReport = async (req, res) => {
    try {
        const { status, startDate, endDate, organizationId } = req.query;

        let query = `
            SELECT
                o.org_id,
                o.org_name,
                t.task_id,
                t.title AS task_title,
                t.description AS task_description,
                t.due_date,
                t.status
            FROM tasks t
            JOIN task_assigned_orgs tao ON t.task_id = tao.task_id
            JOIN organizations o ON tao.org_id = o.org_id
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;

        if (status) {
            const statusConditions = [];
            const statusValues = [];
            const statusArray = status.split(',').map(s => s.trim());

            statusArray.forEach(s => {
                switch (s) {
                    case 'overdue':
                        statusConditions.push(`(t.status != 'completed' AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)`);
                        break;
                    case 'on_time':
                        statusConditions.push(`(t.status != 'completed' AND t.due_date IS NOT NULL AND t.due_date >= CURRENT_DATE)`);
                        break;
                    case 'all':
                        // 'all' means no status filter, so we don't add any condition for it
                        break;
                    default:
                        // For other specific statuses like 'pending', 'completed', etc.
                                if (status) {
            const statusConditions = [];
            const statusValues = [];
            const statusArray = status.split(',').map(s => s.trim());

            statusArray.forEach(s => {
                switch (s) {
                    case 'overdue':
                        statusConditions.push(`(t.status != 'completed' AND t.due_date IS NOT NULL AND t.due_date < CURRENT_DATE)`);
                        break;
                    case 'on_time':
                        statusConditions.push(`(t.status != 'completed' AND t.due_date IS NOT NULL AND t.due_date >= CURRENT_DATE)`);
                        break;
                    case 'all':
                        // 'all' means no status filter, so we don't add any condition for it
                        break;
                    default:
                        // For other specific statuses like 'pending', 'completed', etc.
                        statusConditions.push(`t.status = ${paramIndex + statusValues.length}`); // Use paramIndex + current length of statusValues
                        statusValues.push(s);
                        break;
                }
            });

            if (statusConditions.length > 0) {
                query += ` AND (${statusConditions.join(' OR ')})`;
                params.push(...statusValues);
                paramIndex += statusValues.length; // Increment paramIndex by the number of status values added
            }
        } else {
            // Default to pending if no status is provided
            query += ` AND t.status != 'completed'`;
        }
                        statusValues.push(s);
                        break;
                }
            });

            if (statusConditions.length > 0) {
                query += ` AND (${statusConditions.join(' OR ')})`;
                params.push(...statusValues);
            }
        } else {
            // Default to pending if no status is provided
            query += ` AND t.status != 'completed'`;
        }

        if (startDate) {
            query += ` AND t.due_date >= $${paramIndex++}`;
            params.push(startDate);
        }

        if (endDate) {
            query += ` AND t.due_date <= $${paramIndex++}`;
            params.push(endDate);
        }

        if (organizationId) {
            // Handle single or multiple organization IDs
            const orgIds = Array.isArray(organizationId) ? organizationId : [organizationId];
            query += ` AND o.org_id = ANY($${paramIndex++}::int[])`;
            params.push(orgIds);
        }

        query += ` ORDER BY o.org_name, t.due_date ASC`;

        const { rows } = await db.query(query, params);

        const organizationsMap = new Map();
        let totalTasks = 0;

        rows.forEach(row => {
            if (!organizationsMap.has(row.org_id)) {
                organizationsMap.set(row.org_id, {
                    org_id: row.org_id,
                    org_name: row.org_name,
                    tasks: []
                });
            }
            organizationsMap.get(row.org_id).tasks.push({
                task_id: row.task_id,
                task_title: row.task_title,
                task_description: row.task_description,
                due_date: row.due_date ? row.due_date.toISOString().split('T')[0] : null, // Format date to YYYY-MM-DD
                status: row.status
            });
            totalTasks++;
        });

        const report = {
            report_date: new Date().toISOString().split('T')[0],
            reporter_name: req.user ? req.user.full_name : 'System', // Assuming req.user is populated by authMiddleware
            organizations: Array.from(organizationsMap.values()),
            total_tasks: totalTasks
        };

        res.json(report);

    } catch (error) {
        console.error('Error generating tasks by organization report:', error);
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

module.exports = {
    getTasksByOrganizationReport
};
