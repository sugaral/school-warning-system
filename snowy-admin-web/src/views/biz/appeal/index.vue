<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="7" :md="7" :lg="7" :xl="7">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="学号 / 姓名 / 申诉内容" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="appealType" label="类型">
						<a-input v-model:value="searchFormState.appealType" placeholder="申诉类型" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="status" label="状态">
						<a-select v-model:value="searchFormState.status" placeholder="全部" allow-clear>
							<a-select-option value="submitted">待处理</a-select-option>
							<a-select-option value="approved">已受理</a-select-option>
							<a-select-option value="resolved">已办结</a-select-option>
							<a-select-option value="rejected">已驳回</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
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
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizAppealAdd')">
						<template #icon><plus-outlined /></template>
						代录申诉
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizAppealBatchDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'status'">
					<a-tag :color="statusColor(record.status)">{{ statusLabel(record.status) }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<template v-if="hasPerm('bizAppealHandle')">
						<a @click="openHandleModal(record)">处理</a>
						<a-divider type="vertical" v-if="hasPerm('bizAppealDelete')" />
					</template>
					<a-popconfirm title="确定删除此申诉工单？" @confirm="removeOne(record)">
						<a-button type="link" danger size="small" v-if="hasPerm('bizAppealDelete')">删除</a-button>
					</a-popconfirm>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
	<a-modal v-model:open="handleVisible" title="处理学生申诉工单" :confirm-loading="handleLoading" @ok="submitHandle">
		<a-form layout="vertical">
			<a-form-item label="处理结果状态：" required>
				<a-radio-group v-model:value="handlePayload.status">
					<a-radio value="resolved">已办结 (resolved)</a-radio>
					<a-radio value="approved">已受理 (approved)</a-radio>
					<a-radio value="rejected">驳回 (rejected)</a-radio>
				</a-radio-group>
			</a-form-item>
			<a-form-item label="处理说明（驳回时必填）：" :required="handlePayload.status === 'rejected'">
				<a-textarea v-model:value="handlePayload.resultNote" :rows="3" placeholder="请输入处理结果或驳回理由" />
			</a-form-item>
		</a-form>
	</a-modal>
</template>

<script setup name="bizAppeal">
	import { message } from 'ant-design-vue'
	import bizAppealApi from '@/api/biz/bizAppealApi'
	import Form from './form.vue'

	const columns = [
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '学生姓名', dataIndex: 'studentName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '申诉类型', dataIndex: 'appealType' },
		{ title: '申诉内容', dataIndex: 'content', ellipsis: true },
		{ title: '状态', dataIndex: 'status' },
		{ title: '处理人', dataIndex: 'handlerName' },
		{ title: '处理说明', dataIndex: 'resultNote', ellipsis: true },
		{ title: '创建时间', dataIndex: 'createTime' }
	]
	if (hasPerm(['bizAppealHandle', 'bizAppealDelete'])) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 140 })
	}

	const tableRef = ref(null)
	const formRef = ref()
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])

	const handleVisible = ref(false)
	const handleLoading = ref(false)
	const handlePayload = ref({ id: '', status: 'resolved', resultNote: '' })

	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	const statusLabel = (s) => {
		if (s === 'resolved') return '已办结'
		if (s === 'approved') return '已受理'
		if (s === 'rejected') return '已驳回'
		return '待处理'
	}
	const statusColor = (s) => {
		if (s === 'resolved' || s === 'approved') return 'green'
		if (s === 'rejected') return 'red'
		return 'orange'
	}

	const loadData = (parameter) => bizAppealApi.appealPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const openHandleModal = (record) => {
		handlePayload.value = { id: record.id, status: 'resolved', resultNote: record.resultNote || '' }
		handleVisible.value = true
	}

	const submitHandle = () => {
		if (handlePayload.value.status === 'rejected' && !handlePayload.value.resultNote?.trim()) {
			message.warning('驳回申诉必须填写处理结果说明')
			return
		}
		handleLoading.value = true
		bizAppealApi
			.appealHandle(handlePayload.value)
			.then(() => {
				handleVisible.value = false
				tableRef.value.refresh(true)
			})
			.finally(() => {
				handleLoading.value = false
			})
	}

	const removeOne = (record) => {
		bizAppealApi.appealDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizAppealApi.appealDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
