<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="scope" label="作用范围">
						<a-select v-model:value="searchFormState.scope" placeholder="全部范围" allow-clear>
							<a-select-option value="school">全校默认</a-select-option>
							<a-select-option value="org">学院覆盖</a-select-option>
						</a-select>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="month" label="月份">
						<a-date-picker
							v-model:value="searchFormState.month"
							picker="month"
							value-format="YYYY-MM"
							placeholder="选择月份"
							style="width: 100%"
						/>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="6" :md="6" :lg="6" :xl="6">
					<a-form-item name="searchKey" label="原因">
						<a-input v-model:value="searchFormState.searchKey" placeholder="输入排除原因关键词" allow-clear />
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
		>
			<template #operator>
				<a-space>
					<a-button type="primary" @click="formRef.onOpen()" v-if="hasPerm('bizCalendarAdd')">
						<template #icon><plus-outlined /></template>
						新增排除日
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizCalendarBatchDelete')"
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
					<a-tag :color="record.scope === 'school' ? 'blue' : 'cyan'">
						{{ record.scope === 'school' ? '全校' : record.orgName || '学院' }}
					</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<a-popconfirm title="确定删除该排除日？" @confirm="removeOne(record)">
						<a-button type="link" danger size="small" v-if="hasPerm('bizCalendarDelete')">删除</a-button>
					</a-popconfirm>
				</template>
			</template>
		</s-table>
	</a-card>
	<Form ref="formRef" @successful="tableRef.refresh(true)" />
</template>

<script setup name="bizCalendar">
	import bizCalendarApi from '@/api/biz/bizCalendarApi'
	import Form from './form.vue'

	const columns = [
		{ title: '排除日期', dataIndex: 'exclusionDate' },
		{ title: '适用范围', dataIndex: 'scope' },
		{ title: '排除原因', dataIndex: 'reason' },
		{ title: '创建人', dataIndex: 'creatorName' },
		{ title: '创建时间', dataIndex: 'createTime' }
	]
	if (hasPerm('bizCalendarDelete')) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', width: 100 })
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

	const loadData = (parameter) => bizCalendarApi.calendarPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const removeOne = (record) => {
		bizCalendarApi.calendarDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizCalendarApi.calendarDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
