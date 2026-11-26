<template>
	<a-card :bordered="false">
		<a-form ref="searchFormRef" :model="searchFormState">
			<a-row :gutter="10">
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="searchKey" label="关键词">
						<a-input v-model:value="searchFormState.searchKey" placeholder="学号 / 姓名 / 备注" allow-clear />
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="classId" label="班级">
						<a-select
							v-model:value="searchFormState.classId"
							:options="classOptions"
							:field-names="{ label: 'className', value: 'id' }"
							placeholder="全部班级"
							show-search
							option-filter-prop="className"
							allow-clear
						/>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="5" :md="5" :lg="5" :xl="5">
					<a-form-item name="courseId" label="课程">
						<a-select
							v-model:value="searchFormState.courseId"
							:options="courseOptions"
							:field-names="{ label: 'courseName', value: 'id' }"
							placeholder="全部课程"
							show-search
							option-filter-prop="courseName"
							allow-clear
						/>
					</a-form-item>
				</a-col>
				<a-col :xs="24" :sm="4" :md="4" :lg="4" :xl="4">
					<a-form-item name="recordDate" label="日期">
						<a-date-picker v-model:value="searchFormState.recordDate" value-format="YYYY-MM-DD" class="xn-wd" />
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
					<a-button type="primary" @click="openBatchModal" v-if="hasPerm('bizDailyRecordUpsert')">
						<template #icon><plus-outlined /></template>
						批量录入作业与课堂表现
					</a-button>
					<xn-batch-button
						v-if="hasPerm('bizDailyRecordDelete')"
						buttonName="批量删除"
						icon="DeleteOutlined"
						buttonDanger
						:selectedRowKeys="selectedRowKeys"
						@batchCallBack="deleteBatch"
					/>
				</a-space>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'attendanceStatus'">
					<a-tag :color="attColor(record.attendanceStatus)">{{ attLabel(record.attendanceStatus) }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'homeworkStatus'">
					<a-tag :color="hwColor(record.homeworkStatus)">{{ hwLabel(record.homeworkStatus) }}</a-tag>
				</template>
				<template v-if="column.dataIndex === 'classBehavior'">
					<a-tag v-if="record.classBehavior" :color="record.classBehavior === 'disruptive' ? 'red' : 'green'">
						{{ record.classBehavior === 'disruptive' ? '违纪' : '正常' }}
					</a-tag>
				</template>
				<template v-if="column.dataIndex === 'action'">
					<a-popconfirm title="确定删除此条日记录？" @confirm="removeOne(record)">
						<a-button type="link" danger size="small" v-if="hasPerm('bizDailyRecordDelete')">删除</a-button>
					</a-popconfirm>
				</template>
			</template>
		</s-table>
	</a-card>
	<a-modal
		v-model:open="batchVisible"
		title="批量录入日作业与课堂表现"
		width="860"
		:confirm-loading="batchLoading"
		@ok="submitBatch"
	>
		<a-row :gutter="10" style="margin-bottom: 12px">
			<a-col :span="8">
				<a-select
					v-model:value="batchMeta.classId"
					:options="classOptions"
					:field-names="{ label: 'className', value: 'id' }"
					placeholder="先选择班级加载学生"
					class="xn-wd"
					@change="loadClassStudents"
				/>
			</a-col>
			<a-col :span="8">
				<a-select
					v-model:value="batchMeta.courseId"
					:options="courseOptions"
					:field-names="{ label: 'courseName', value: 'id' }"
					placeholder="选择对应课程（必填）"
					class="xn-wd"
				/>
			</a-col>
			<a-col :span="8">
				<a-date-picker v-model:value="batchMeta.recordDate" value-format="YYYY-MM-DD" class="xn-wd" />
			</a-col>
		</a-row>
		<a-table :columns="batchCols" :data-source="batchRows" row-key="studentId" size="small" :pagination="false" :scroll="{ y: 340 }">
			<template #bodyCell="{ column, record }">
				<template v-if="column.dataIndex === 'homeworkStatus'">
					<a-select v-model:value="record.homeworkStatus" size="small" class="xn-wd">
						<a-select-option value="submitted">已提交</a-select-option>
						<a-select-option value="not_submit">未提交</a-select-option>
						<a-select-option value="late_submit">迟交</a-select-option>
						<a-select-option value="unknown">暂不更改</a-select-option>
					</a-select>
				</template>
				<template v-if="column.dataIndex === 'classBehavior'">
					<a-select v-model:value="record.classBehavior" size="small" class="xn-wd">
						<a-select-option value="normal">正常</a-select-option>
						<a-select-option value="disruptive">课堂违纪</a-select-option>
					</a-select>
				</template>
				<template v-if="column.dataIndex === 'remarks'">
					<a-input v-model:value="record.remarks" size="small" placeholder="备注（选填）" />
				</template>
			</template>
		</a-table>
	</a-modal>
</template>

<script setup name="bizAttendanceDaily">
	import { message } from 'ant-design-vue'
	import dayjs from 'dayjs'
	import bizAttendanceApi from '@/api/biz/bizAttendanceApi'
	import bizClassApi from '@/api/biz/bizClassApi'
	import bizCourseApi from '@/api/biz/bizCourseApi'
	import bizStudentApi from '@/api/biz/bizStudentApi'

	const columns = [
		{ title: '日期', dataIndex: 'recordDate' },
		{ title: '学号', dataIndex: 'studentNo' },
		{ title: '姓名', dataIndex: 'studentName' },
		{ title: '班级', dataIndex: 'className' },
		{ title: '课程', dataIndex: 'courseName' },
		{ title: '出勤', dataIndex: 'attendanceStatus' },
		{ title: '作业状态', dataIndex: 'homeworkStatus' },
		{ title: '课堂表现', dataIndex: 'classBehavior' },
		{ title: '备注', dataIndex: 'remarks', ellipsis: true },
		{ title: '来源', dataIndex: 'source' }
	]
	if (hasPerm('bizDailyRecordDelete')) {
		columns.push({ title: '操作', dataIndex: 'action', align: 'center', fixed: 'right', width: 90 })
	}

	const batchCols = [
		{ title: '学号', dataIndex: 'studentNo', width: 130 },
		{ title: '姓名', dataIndex: 'studentName', width: 100 },
		{ title: '作业状态', dataIndex: 'homeworkStatus', width: 150 },
		{ title: '课堂表现', dataIndex: 'classBehavior', width: 130 },
		{ title: '备注', dataIndex: 'remarks' }
	]

	const tableRef = ref(null)
	const searchFormRef = ref()
	const searchFormState = ref({})
	const selectedRowKeys = ref([])
	const classOptions = ref([])
	const courseOptions = ref([])

	const batchVisible = ref(false)
	const batchLoading = ref(false)
	const batchMeta = ref({ classId: undefined, courseId: undefined, recordDate: dayjs().format('YYYY-MM-DD') })
	const batchRows = ref([])

	const options = {
		rowSelection: {
			onChange: (keys) => {
				selectedRowKeys.value = keys
			}
		}
	}

	bizClassApi.clazzList({}).then((data) => {
		classOptions.value = data || []
	})
	bizCourseApi.courseList({}).then((data) => {
		courseOptions.value = data || []
	})

	const attLabel = (s) => ({ on_time: '准时', late: '迟到', absent: '缺勤', leave: '请假', early_leave: '早退', present: '出勤' }[s] || s)
	const attColor = (s) => ({ on_time: 'green', present: 'green', late: 'orange', leave: 'blue', absent: 'red', early_leave: 'volcano' }[s] || 'default')
	const hwLabel = (s) => ({ submitted: '已交', not_submit: '未交', late_submit: '迟交', unknown: '未知' }[s] || s)
	const hwColor = (s) => ({ submitted: 'green', not_submit: 'red', late_submit: 'orange' }[s] || 'default')

	const loadData = (parameter) => bizAttendanceApi.dailyPage(Object.assign(parameter, searchFormState.value))

	const reset = () => {
		searchFormRef.value.resetFields()
		tableRef.value.refresh(true)
	}

	const openBatchModal = () => {
		batchMeta.value = { classId: undefined, courseId: undefined, recordDate: dayjs().format('YYYY-MM-DD') }
		batchRows.value = []
		batchVisible.value = true
	}

	const loadClassStudents = (classId) => {
		if (!classId) {
			batchRows.value = []
			return
		}
		bizStudentApi.studentPage({ current: 1, size: 100, classId }).then((page) => {
			batchRows.value = (page?.records || []).map((s) => ({
				studentId: s.id,
				studentNo: s.studentNo,
				studentName: s.name,
				homeworkStatus: 'submitted',
				classBehavior: 'normal',
				remarks: ''
			}))
		})
	}

	const submitBatch = () => {
		if (!batchMeta.value.courseId || !batchMeta.value.recordDate || batchRows.value.length === 0) {
			message.warning('请选择班级、课程与日期，并确保学生列表非空')
			return
		}
		batchLoading.value = true
		const payload = batchRows.value.map((r) => ({
			studentId: r.studentId,
			courseId: batchMeta.value.courseId,
			recordDate: batchMeta.value.recordDate,
			homeworkStatus: r.homeworkStatus === 'unknown' ? undefined : r.homeworkStatus,
			classBehavior: r.classBehavior,
			remarks: r.remarks
		}))
		bizAttendanceApi
			.dailyBatchUpsert(payload)
			.then((res) => {
				message.success(`批量录入完成：新增 ${res?.created ?? 0} 条，更新 ${res?.updated ?? 0} 条`)
				batchVisible.value = false
				tableRef.value.refresh(true)
			})
			.finally(() => {
				batchLoading.value = false
			})
	}

	const removeOne = (record) => {
		bizAttendanceApi.dailyDelete([{ id: record.id }]).then(() => tableRef.value.refresh(true))
	}

	const deleteBatch = (params) => {
		bizAttendanceApi.dailyDelete(params).then(() => tableRef.value.clearRefreshSelected())
	}
</script>
