<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="scope" label="范围">
						<a-select v-model:value="searchFormState.scope" placeholder="全部" allow-clear>
							<a-select-option value="school">全校默认</a-select-option>
							<a-select-option value="college">院级覆盖</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="metric" label="指标">
						<a-select v-model:value="searchFormState.metric" :options="METRIC_OPTIONS" placeholder="全部指标" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="4" :md="4" :lg="4" :xl="4">
					<a-form-item name="windowType" label="窗口">
						<a-select v-model:value="searchFormState.windowType" :options="WINDOW_OPTIONS" placeholder="全部" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="4" :md="4" :lg="4" :xl="4">
					<a-form-item name="level" label="级别">
						<a-select v-model:value="searchFormState.level" :options="LEVEL_OPTIONS" placeholder="全部" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item>
						<a-space>
							<a-button type="primary" @click="tableRef.refresh(true)">
								<template #icon><SearchOutlined /></template>
								查询
							</a-button>
							<a-button @click="reset">
								<template #icon><redo-outlined /></template>
								重置
							</a-button>
						</a-space>
					</a-form-item>
				</a-col>
			</a-row>
		</a-form>
		<s-table
			ref="tableRef"
			:columns="columns"
			:data="loadData"
			:alert="false"
			bordered
			:tool-config="{ refresh: true, height: true, columnSetting: true }"
			:row-key="(record) => record.id"
			:row-selection="options.rowSelection"
			:scroll="{ x: 'max-content' }"
		>
			<template #operator>
				<a-space>
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizWarningRuleAdd')">
						<template #icon><plus-outlined /></template>
						新增规则
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizWarningRuleBatchDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'scope'">
					<a-tag :color="record.scope === 'school' ? 'blue' : 'purple'">
						{{ record.scope === 'school' ? '全校默认' : record.orgName || '院级覆盖' }}
					</a-tag>
				</template>
				<template v-if="column.dataIndex === 'metric'">
					{{ labelOf(METRIC_OPTIONS, record.metric) }}
				</template>
				<template v-if="column.dataIndex === 'windowType'">
					{{ labelOf(WINDOW_OPTIONS, record.windowType) }}
				</template>
				<template v-if="column.dataIndex === 'level'">
					<a-tag :color="levelColor(record.level)">{{ labelOf(LEVEL_OPTIONS, record.level) }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'enabled'">
					<a-tag :color="record.enabled ? 'green' : 'default'">{{ record.enabled ? '启用' : '停用' }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<a @click="formRef.onOpen(record)" v-if="hasPerm('bizWarningRuleEdit')">编辑</a>
					<a-divider type="vertical" v-if="hasPerm(['bizWarningRuleEdit', 'bizWarningRuleDelete'], 'and')" />
					<a-popconfirm title="确定删除该预警规则？" @confirm="removeOne(record)">
						<a-button type="link" danger size="small" v-if="hasPerm('bizWarningRuleDelete')">删除</a-button>
					</a-popconfirm>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
</template>

<script setup name="bizWarningRule">
	import bizWarningRuleApi from '@/api/biz/bizWarningRuleApi'
	import Form from './form.vue'

	const METRIC_OPTIONS = [
		{ label: '缺勤次数', value: 'absent' },
		{ label: '迟到次数', value: 'late' },
		{ label: '早退次数', value: 'early_leave' },
		{ label: '请假次数', value: 'leave' },
		{ label: '作业未交', value: 'homework_not_submit' },
		{ label: '作业迟交', value: 'homework_late_submit' },
		{ label: '课堂违纪', value: 'class_behavior' },
		{ label: '累计预警', value: 'warning_total' },
		{ label: '未确认预警', value: 'unacknowledged' },
		{ label: '挂科门数（仅学期）', value: 'failed_courses' },
		{ label: '已修学分×10（仅学期）', value: 'credits' },
		{ label: '平均绩点×100（仅学期）', value: 'gpa' }
	]
	const WINDOW_OPTIONS = [
		{ label: '日窗口', value: 'day' },
		{ label: '周窗口', value: 'week' },
		{ label: '月窗口', value: 'month' },
		{ label: '学期窗口', value: 'term' }
	]
	const LEVEL_OPTIONS = [
		{ label: '黄色预警', value: 'yellow' },
		{ label: '橙色预警', value: 'orange' },
		{ label: '红色预警', value: 'red' },
		{ label: '严重预警', value: 'severe' }
	]

	const labelOf = (list, val) => (list.find((i) => i.value === val) || {}).label || val
	const levelColor = (lvl) => ({ yellow: 'gold', orange: 'orange', red: 'red', severe: 'magenta' }[lvl] || 'default')

	const columns = [
		{ title: '作用域', dataIndex: 'scope' },
		{ title: '统计指标', dataIndex: 'metric' },
		{ title: '统计窗口', dataIndex: 'windowType' },
		{ title: '预警级别', dataIndex: 'level' },
		{ title: '触发阈值', dataIndex: 'threshold' },
		{ title: '版本号', dataIndex: 'ruleVersion' },
		{ title: '状态', dataIndex: 'enabled' },
		{ title: '创建时间', dataIndex: 'createTime' }
	]
	if (hasPerm(['bizWarningRuleEdit', 'bizWarningRuleDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 140 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])
	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	const loadData = (parameter) => bizWarningRuleApi.rulePage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizWarningRuleApi.ruleDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizWarningRuleApi.ruleDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
